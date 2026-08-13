const express = require("express");
const router = express.Router();
const hre = require("hardhat");
const { ethers } = hre;
const { runQuery } = require("../db");
const fs = require("fs");
const path = require("path");

// 1. 등록된 물류사 및 유통사 목록 조회 API (GET /api/logistics/companies)
router.get("/companies", async (req, res) => {
  try {
    const companies = await runQuery(
      `SELECT address, company_name, role FROM participants WHERE role IN ('LOGISTICS', 'DISTRIBUTOR', 'MANUFACTURER', 'SUPPLIER') ORDER BY company_name ASC`
    );
    res.json({ success: true, count: companies.length, companies });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 2. 이관 가능한 배치 목록 및 현재 보관자 상태 조회 API (GET /api/logistics/transferable-batches)
router.get("/transferable-batches", async (req, res) => {
  try {
    const summaryPath = path.join(__dirname, "..", "..", "data", "supply_chain_dataset_summary.json");
    if (!fs.existsSync(summaryPath)) {
      return res.status(500).json({ success: false, message: "스마트 컨트랙트 배포 정보를 찾을 수 없습니다." });
    }

    const summary = JSON.parse(fs.readFileSync(summaryPath, "utf-8"));
    const operations = await ethers.getContractAt("ChainTraceOperations", summary.contracts.operations);

    const batches = await runQuery(`SELECT * FROM batches ORDER BY created_at DESC`);
    const recalls = await runQuery(`SELECT batch_id FROM recalls`);
    const recalledSet = new Set(recalls.map(r => r.batch_id));

    const result = [];
    for (const b of batches) {
      const isRecalled = recalledSet.has(b.batch_id);
      const inspections = await runQuery(`SELECT is_passed FROM inspections WHERE batch_id = ? ORDER BY timestamp DESC LIMIT 1`, [b.batch_id]);

      let inspectStatus = "UNTESTED";
      if (inspections.length > 0) {
        inspectStatus = inspections[0].is_passed ? "PASSED" : "FAILED";
      }

      let status = "NORMAL";
      if (isRecalled) status = "RECALLED";
      else if (inspectStatus === "FAILED") status = "QUARANTINED";

      let currentCustodian = "0x0000000000000000000000000000000000000000";
      let custodianName = "";
      try {
        currentCustodian = await operations.getCurrentCustodian(b.batch_id);
        const part = await runQuery(`SELECT company_name FROM participants WHERE LOWER(address) = LOWER(?)`, [currentCustodian]);
        if (part.length > 0) custodianName = part[0].company_name;
      } catch (e) {
        currentCustodian = b.creator;
      }

      result.push({
        batchId: b.batch_id,
        batchType: b.batch_type || (b.batch_id.startsWith("FG-") ? "FINISHED_GOODS" : b.batch_id.startsWith("INT-") ? "INTERMEDIATE" : "RAW_MATERIAL"),
        productName: b.product_name,
        quantity: b.quantity,
        unit: b.unit,
        creator: b.creator,
        custodian: currentCustodian,
        custodianName: custodianName || "원료/제조사",
        status: status,
        isTransferable: status === "NORMAL"
      });
    }

    res.json({ success: true, count: result.length, batches: result });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 3. 소유권 이관 요청 온체인 서명 API (POST /api/logistics/request-transfer)
router.post("/request-transfer", async (req, res) => {
  try {
    const { senderAddress, batchId, toAddress, location, notes } = req.body;

    if (!senderAddress || !batchId || !toAddress) {
      return res.status(400).json({ success: false, message: "필수 파라미터(발송 주소, 배치 ID, 인수 주소)가 누락되었습니다." });
    }

    const cleanToAddress = ethers.getAddress(toAddress.toLowerCase());
    const cleanSenderAddress = ethers.getAddress(senderAddress.toLowerCase());

    const summaryPath = path.join(__dirname, "..", "..", "data", "supply_chain_dataset_summary.json");
    const summary = JSON.parse(fs.readFileSync(summaryPath, "utf-8"));
    const registryAddr = summary.contracts.registry;
    const operationsAddr = summary.contracts.operations;

    const registry = await ethers.getContractAt("ChainTraceRegistry", registryAddr);
    const operations = await ethers.getContractAt("ChainTraceOperations", operationsAddr);

    const signers = await ethers.getSigners();
    const adminSigner = signers[0];

    // 🔒 배치 온체인 생존 자동 검차 및 동기화 (Batch does not exist 방지)
    const exists = await registry.batchExists(batchId);
    if (!exists) {
      console.log(`📦 [온체인 미등록 배치 자동 생성] ${batchId} 온체인 배치 등록 중...`);
      const bInfo = await runQuery(`SELECT * FROM batches WHERE batch_id = ?`, [batchId]);
      const pName = bInfo.length > 0 ? bInfo[0].product_name : batchId;
      const supplierRole = await registry.SUPPLIER_ROLE();
      await registry.connect(adminSigner).grantRole(supplierRole, adminSigner.address);
      const syncTx = await registry.connect(adminSigner).createRawMaterialBatch(
        batchId, pName, 100, "box", `ipfs://QmSync_${batchId}`
      );
      await syncTx.wait();
    }

    // 🚨 결함/격리/리콜 배치 온체인 이관 사전 차단 검증
    const statusNum = await operations.getBatchStatus(batchId);
    if (statusNum === 1n) {
      return res.status(400).json({ success: false, message: `🚨 이관 거부: 배치 [${batchId}]는 온체인 격리(QUARANTINED) 상태이므로 이관할 수 없습니다!` });
    }
    if (statusNum === 2n) {
      return res.status(400).json({ success: false, message: `🚨 이관 거부: 배치 [${batchId}]는 온체인 리콜(RECALLED) 상태이므로 이관할 수 없습니다!` });
    }

    let currentCustodian = await operations.getCurrentCustodian(batchId);
    if (currentCustodian === "0x0000000000000000000000000000000000000000") {
      const bInfo = await runQuery(`SELECT creator FROM batches WHERE batch_id = ?`, [batchId]);
      if (bInfo.length > 0) currentCustodian = bInfo[0].creator;
    }

    // 온체인 상 실제 보관자의 지갑 서명자 자동 매칭
    const senderSigner = signers.find(s => s.address.toLowerCase() === currentCustodian.toLowerCase()) ||
                         signers.find(s => s.address.toLowerCase() === cleanSenderAddress.toLowerCase()) ||
                         adminSigner;

    // 🔒 발송자/인수자 AccessControl 권한 자동 검증 및 부여
    const logisticsRole = await registry.LOGISTICS_ROLE();
    const hasLogRole = await registry.hasRole(logisticsRole, senderSigner.address);
    if (!hasLogRole) {
      console.log(`🔑 [권한 자동 부여] ${senderSigner.address} 계정에 LOGISTICS_ROLE 부여 중...`);
      const grantTx = await registry.connect(adminSigner).grantRole(logisticsRole, senderSigner.address);
      await grantTx.wait();
    }

    console.log(`🚚 [물류 소유권 이관 요청] 실시간 보관자 서명: ${senderSigner.address} ➔ 인수자: ${cleanToAddress} | 배치: ${batchId}`);

    const tx = await operations.connect(senderSigner).requestTransfer(
      batchId,
      cleanToAddress,
      location || "물류 센터 이동 중",
      notes || "콜드체인 4℃ 유지 적정 규격 운송"
    );

    const receipt = await tx.wait();

    // DuckDB 이관 요청 수록
    const reqTime = new Date().toISOString();
    await runQuery(
      `INSERT INTO transfers VALUES (?, ?, ?, ?, ?, ?, true, false)`,
      [batchId, senderSigner.address, cleanToAddress, location || "물류 센터 이동 중", notes || "콜드체인 4℃ 유지 적정 규격 운송", reqTime]
    );

    res.json({
      success: true,
      message: `배치 [${batchId}]에 대한 소유권 이관 요청이 블록체인에 전송되었습니다.`,
      transfer: {
        batchId,
        fromAddress: senderSigner.address,
        toAddress: cleanToAddress,
        location: location || "물류 센터 이동 중",
        notes: notes || "콜드체인 4℃ 유지 적정 규격 운송",
        transactionHash: receipt.hash,
        blockNumber: receipt.blockNumber,
        timestamp: reqTime,
        status: "PENDING_ACCEPTANCE"
      }
    });
  } catch (err) {
    console.error("❌ 이관 요청 에러:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// 4. 소유권 이관 수락 API (POST /api/logistics/accept-transfer)
router.post("/accept-transfer", async (req, res) => {
  try {
    const { receiverAddress, batchId } = req.body;

    if (!receiverAddress || !batchId) {
      return res.status(400).json({ success: false, message: "필수 파라미터(인수자 주소, 배치 ID)가 누락되었습니다." });
    }

    const cleanReceiverAddress = ethers.getAddress(receiverAddress.toLowerCase());

    const summaryPath = path.join(__dirname, "..", "..", "data", "supply_chain_dataset_summary.json");
    const summary = JSON.parse(fs.readFileSync(summaryPath, "utf-8"));
    const registryAddr = summary.contracts.registry;
    const operationsAddr = summary.contracts.operations;

    const registry = await ethers.getContractAt("ChainTraceRegistry", registryAddr);
    const operations = await ethers.getContractAt("ChainTraceOperations", operationsAddr);

    const signers = await ethers.getSigners();
    const receiverSigner = signers.find(s => s.address.toLowerCase() === cleanReceiverAddress.toLowerCase()) || signers[18];

    // 🔒 물류사/유통사 권한 자동 확인 및 부여
    const logisticsRole = await registry.LOGISTICS_ROLE();
    const distRole = await registry.DISTRIBUTOR_ROLE();
    const hasLogRole = await registry.hasRole(logisticsRole, receiverSigner.address);
    const hasDistRole = await registry.hasRole(distRole, receiverSigner.address);

    if (!hasLogRole && !hasDistRole) {
      console.log(`🔑 [권한 자동 부여] ${receiverSigner.address} 계정에 LOGISTICS_ROLE 부여 중...`);
      const adminSigner = signers[0];
      const grantTx = await registry.connect(adminSigner).grantRole(logisticsRole, receiverSigner.address);
      await grantTx.wait();
    }

    console.log(`🤝 [물류 소유권 이관 인도 수락] 인수자: ${receiverSigner.address} | 배치: ${batchId}`);

    const tx = await operations.connect(receiverSigner).acceptTransfer(batchId);
    const receipt = await tx.wait();

    const acceptTime = new Date().toISOString();
    await runQuery(`UPDATE transfers SET is_pending = false, is_completed = true WHERE batch_id = ? AND LOWER(to_address) = LOWER(?)`, [batchId, receiverSigner.address]);

    const newCustodian = await operations.getCurrentCustodian(batchId);

    res.json({
      success: true,
      message: `배치 [${batchId}]의 소유권 이관이 성공적으로 수락 완료되었습니다.`,
      receipt: {
        batchId,
        newCustodian,
        acceptedBy: receiverSigner.address,
        transactionHash: receipt.hash,
        blockNumber: receipt.blockNumber,
        timestamp: acceptTime,
        blockchainStatus: "TRANSFER_COMPLETED"
      }
    });
  } catch (err) {
    console.error("❌ 이관 수락 에러:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// 5. 물류사별 이관 요청/완료 이력 목록 API (GET /api/logistics/transfers/:address)
router.get("/transfers/:address", async (req, res) => {
  try {
    const { address } = req.params;
    let pendingTransfers = [];
    let completedTransfers = [];

    if (address === "all") {
      pendingTransfers = await runQuery(`SELECT * FROM transfers WHERE is_pending = true ORDER BY timestamp DESC`);
      completedTransfers = await runQuery(`SELECT * FROM transfers WHERE is_completed = true ORDER BY timestamp DESC`);
    } else {
      pendingTransfers = await runQuery(
        `SELECT * FROM transfers WHERE LOWER(to_address) = LOWER(?) AND is_pending = true ORDER BY timestamp DESC`,
        [address]
      );
      completedTransfers = await runQuery(
        `SELECT * FROM transfers WHERE (LOWER(from_address) = LOWER(?) OR LOWER(to_address) = LOWER(?)) AND is_completed = true ORDER BY timestamp DESC`,
        [address, address]
      );
    }

    res.json({ success: true, pendingTransfers, completedTransfers });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
