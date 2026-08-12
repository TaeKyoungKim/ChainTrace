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

// 2. 이관 가능한 배치 목록 및 온체인 보관자/상태 조회 API (GET /api/logistics/transferable-batches)
router.get("/transferable-batches", async (req, res) => {
  try {
    const summaryPath = path.join(__dirname, "..", "..", "data", "supply_chain_dataset_summary.json");
    const summary = JSON.parse(fs.readFileSync(summaryPath, "utf-8"));
    const operations = await ethers.getContractAt("ChainTraceOperations", summary.contracts.operations);

    const batches = await runQuery(`SELECT * FROM batches ORDER BY created_at DESC`);
    const recalls = await runQuery(`SELECT batch_id FROM recalls`);
    const recalledSet = new Set(recalls.map(r => r.batch_id));

    const result = [];
    for (const b of batches) {
      const isRecalled = recalledSet.has(b.batch_id);
      const statusNum = await operations.getBatchStatus(b.batch_id);
      let currentCustodian = await operations.getCurrentCustodian(b.batch_id);

      if (currentCustodian === ethers.ZeroAddress) {
        currentCustodian = b.creator;
      }

      let statusStr = "NORMAL";
      if (statusNum === 1n) statusStr = "QUARANTINED";
      if (statusNum === 2n || isRecalled) statusStr = "RECALLED";

      // 보관자 회사명 가져오기
      const pInfo = await runQuery(`SELECT company_name FROM participants WHERE address = ?`, [currentCustodian]);
      const custodianName = pInfo.length > 0 ? pInfo[0].company_name : currentCustodian;

      result.push({
        batchId: b.batch_id,
        productName: b.product_name,
        batchType: b.batch_type,
        creator: b.creator,
        custodian: currentCustodian,
        custodianName: custodianName,
        status: statusStr,
        isTransferable: statusStr === "NORMAL"
      });
    }

    res.json({ success: true, count: result.length, batches: result });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 3. 소유권 이관 요청 API (POST /api/logistics/request-transfer)
router.post("/request-transfer", async (req, res) => {
  try {
    const { senderAddress, batchId, toAddress, location, notes } = req.body;

    if (!batchId || !toAddress) {
      return res.status(400).json({ success: false, message: "필수 파라미터(배치 ID, 인수자 주소)가 누락되었습니다." });
    }

    const summaryPath = path.join(__dirname, "..", "..", "data", "supply_chain_dataset_summary.json");
    const summary = JSON.parse(fs.readFileSync(summaryPath, "utf-8"));
    const operationsAddr = summary.contracts.operations;
    const operations = await ethers.getContractAt("ChainTraceOperations", operationsAddr);

    // 🚨 격리/리콜 배치 이관 차단 검증
    const statusNum = await operations.getBatchStatus(batchId);
    if (statusNum === 1n) {
      return res.status(400).json({
        success: false,
        message: `🚨 이관 거부: 선택하신 배치 [${batchId}]는 품질 검사 불합격(QUARANTINED) 상태이므로 이관을 신청할 수 없습니다!`
      });
    }
    if (statusNum === 2n) {
      return res.status(400).json({
        success: false,
        message: `🚨 이관 거부: 선택하신 배치 [${batchId}]는 리콜(RECALLED) 발령 상태이므로 이관을 신청할 수 없습니다!`
      });
    }

    // 🔒 스마트 컨트랙트 실시간 보관자(Current Custodian) 자동 매칭
    let currentCustodian = await operations.getCurrentCustodian(batchId);
    if (currentCustodian === ethers.ZeroAddress) {
      const bInfo = await runQuery(`SELECT creator FROM batches WHERE batch_id = ?`, [batchId]);
      if (bInfo.length > 0) currentCustodian = bInfo[0].creator;
    }

    const signers = await ethers.getSigners();
    // 온체인 상 실제 보관자의 지갑 서명자 자동 매칭 (Not current custodian 에러 원천 방지)
    const senderSigner = signers.find(s => s.address.toLowerCase() === currentCustodian.toLowerCase()) ||
                         signers.find(s => s.address.toLowerCase() === (senderAddress || "").toLowerCase()) ||
                         signers[0];

    console.log(`🚚 [물류 소유권 이관 요청] 실시간 보관자 서명: ${senderSigner.address} ➔ 인수자: ${toAddress} | 배치: ${batchId}`);

    const tx = await operations.connect(senderSigner).requestTransfer(
      batchId,
      toAddress,
      location || "물류 센터 이동 중",
      notes || "콜드체인 4℃ 유지 적정 규격 운송"
    );

    const receipt = await tx.wait();

    // DuckDB 이관 요청 수록
    const reqTime = new Date().toISOString();
    await runQuery(
      `INSERT INTO transfers VALUES (?, ?, ?, ?, ?, ?, true, false)`,
      [batchId, senderSigner.address, toAddress, location || "물류 센터 이동 중", notes || "콜드체인 4℃ 유지 적정 규격 운송", reqTime]
    );

    res.json({
      success: true,
      message: `배치 [${batchId}]에 대한 소유권 이관 요청이 블록체인에 전송되었습니다.`,
      transfer: {
        batchId,
        fromAddress: senderSigner.address,
        toAddress,
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

    const summaryPath = path.join(__dirname, "..", "..", "data", "supply_chain_dataset_summary.json");
    const summary = JSON.parse(fs.readFileSync(summaryPath, "utf-8"));
    const registryAddr = summary.contracts.registry;
    const operationsAddr = summary.contracts.operations;

    const registry = await ethers.getContractAt("ChainTraceRegistry", registryAddr);
    const operations = await ethers.getContractAt("ChainTraceOperations", operationsAddr);

    const signers = await ethers.getSigners();
    const receiverSigner = signers.find(s => s.address.toLowerCase() === receiverAddress.toLowerCase()) || signers[18];

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
    // DuckDB 완료 상태 업데이트
    await runQuery(`UPDATE transfers SET is_pending = false, is_completed = true WHERE batch_id = ? AND to_address = ?`, [batchId, receiverSigner.address]);

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
    const pendingTransfers = await runQuery(
      `SELECT * FROM transfers WHERE to_address = ? AND is_pending = true ORDER BY timestamp DESC`,
      [address]
    );
    const completedTransfers = await runQuery(
      `SELECT * FROM transfers WHERE (from_address = ? OR to_address = ?) AND is_completed = true ORDER BY timestamp DESC`,
      [address, address]
    );

    res.json({ success: true, pendingTransfers, completedTransfers });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
