const express = require("express");
const router = express.Router();
const hre = require("hardhat");
const { ethers } = hre;
const { runQuery } = require("../db");
const fs = require("fs");
const path = require("path");

// 1. 투입 가능한 원료 배치 목록 및 상태 조회 API (GET /api/manufacturer/raw-batches)
router.get("/raw-batches", async (req, res) => {
  try {
    const rawBatches = await runQuery(`SELECT * FROM batches WHERE batch_type = 'RAW_MATERIAL' ORDER BY created_at DESC`);
    const recalls = await runQuery(`SELECT batch_id FROM recalls`);
    const recalledSet = new Set(recalls.map(r => r.batch_id));

    const result = [];
    for (const b of rawBatches) {
      const isRecalled = recalledSet.has(b.batch_id);
      const inspections = await runQuery(`SELECT is_passed FROM inspections WHERE batch_id = ? ORDER BY timestamp DESC LIMIT 1`, [b.batch_id]);
      let inspectStatus = "UNTESTED";
      if (inspections.length > 0) {
        inspectStatus = inspections[0].is_passed ? "PASSED" : "FAILED";
      }

      let status = "NORMAL";
      if (isRecalled) status = "RECALLED";
      else if (inspectStatus === "FAILED") status = "QUARANTINED";

      result.push({
        batchId: b.batch_id,
        productName: b.product_name,
        quantity: b.quantity,
        unit: b.unit,
        creator: b.creator,
        createdAt: b.created_at,
        status: status,
        isUsable: status === "NORMAL"
      });
    }

    res.json({ success: true, count: result.length, rawBatches: result });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 2. 완제품 제조 무역원장 수록 API (POST /api/manufacturer/create-batch)
router.post("/create-batch", async (req, res) => {
  try {
    const { manufacturerAddress, batchId, productName, quantity, unit, parentBatchIds, metadataHash } = req.body;

    if (!manufacturerAddress || !batchId || !productName || !quantity || !parentBatchIds || parentBatchIds.length === 0) {
      return res.status(400).json({ success: false, message: "필수 파라미터 또는 투입 원료 배치 ID가 누락되었습니다." });
    }

    // 🚨 리콜/격리 원료 투입 사전 차단 검증
    for (const pId of parentBatchIds) {
      const recalls = await runQuery(`SELECT * FROM recalls WHERE batch_id = ?`, [pId]);
      if (recalls.length > 0) {
        return res.status(400).json({
          success: false,
          message: `🚨 제조 거부: 선택하신 원료 배치 [${pId}]는 리콜(RECALLED) 상태이므로 제조에 투입할 수 없습니다!`
        });
      }
      const inspects = await runQuery(`SELECT is_passed FROM inspections WHERE batch_id = ? ORDER BY timestamp DESC LIMIT 1`, [pId]);
      if (inspects.length > 0 && !inspects[0].is_passed) {
        return res.status(400).json({
          success: false,
          message: `⚠️ 제조 거부: 선택하신 원료 배치 [${pId}]는 품질 검사 불합격(QUARANTINED) 상태이므로 제조에 투입할 수 없습니다!`
        });
      }
    }

    const summaryPath = path.join(__dirname, "..", "..", "data", "supply_chain_dataset_summary.json");
    if (!fs.existsSync(summaryPath)) {
      return res.status(500).json({ success: false, message: "스마트 컨트랙트 배포 정보를 찾을 수 없습니다." });
    }

    const summary = JSON.parse(fs.readFileSync(summaryPath, "utf-8"));
    const registryAddr = summary.contracts.registry;
    const registry = await ethers.getContractAt("ChainTraceRegistry", registryAddr);

    const signers = await ethers.getSigners();
    const mfgSigner = signers.find(s => s.address.toLowerCase() === manufacturerAddress.toLowerCase()) || signers[11];

    console.log(`📝 [제조사 완제품 무역원장 등록] 제조사: ${mfgSigner.address} | 완제품: ${batchId} | 원료: ${parentBatchIds.join(", ")}`);

    // 스마트 컨트랙트 createManufacturedBatch 호출
    const tx = await registry.connect(mfgSigner).createManufacturedBatch(
      batchId,
      productName,
      quantity,
      unit || "box",
      parentBatchIds,
      metadataHash || `ipfs://QmIntMeta_${batchId}`
    );

    const receipt = await tx.wait();

    // DuckDB 인덱싱
    const createdTime = new Date().toISOString();
    await runQuery(
      `INSERT INTO batches VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [batchId, "MANUFACTURED", mfgSigner.address, productName, Number(quantity), unit || "box", createdTime, metadataHash || `ipfs://QmIntMeta_${batchId}`]
    );

    for (const pId of parentBatchIds) {
      await runQuery(`INSERT INTO genealogy VALUES (?, ?)`, [pId, batchId]);
    }

    const certificate = {
      batchId,
      productName,
      quantity: `${quantity} ${unit || "box"}`,
      manufacturerAddress: mfgSigner.address,
      parentBatchIds,
      transactionHash: receipt.hash,
      blockNumber: receipt.blockNumber,
      timestamp: createdTime,
      blockchainStatus: "CONFIRMED_ON_CHAIN"
    };

    res.json({
      success: true,
      message: "완제품 무역원장이 성공적으로 블록체인 및 DuckDB에 연결 기록되었습니다.",
      certificate
    });
  } catch (err) {
    console.error("❌ 제조사 무역원장 등록 에러:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// 3. 자사 제조 배치 온체인 리콜 발령 API (POST /api/manufacturer/trigger-recall)
router.post("/trigger-recall", async (req, res) => {
  try {
    const { manufacturerAddress, batchId, reason } = req.body;
    if (!batchId || !reason) {
      return res.status(400).json({ success: false, message: "배치 ID 및 리콜 사유가 누락되었습니다." });
    }

    const summaryPath = path.join(__dirname, "..", "..", "data", "supply_chain_dataset_summary.json");
    const summary = JSON.parse(fs.readFileSync(summaryPath, "utf-8"));
    const operations = await ethers.getContractAt("ChainTraceOperations", summary.contracts.operations);

    const signers = await ethers.getSigners();
    const mfgSigner = signers.find(s => s.address.toLowerCase() === manufacturerAddress.toLowerCase()) || signers[0];

    console.log(`🚨 [제조사 자발적 리콜 발령] 배치: ${batchId} | 사유: ${reason}`);

    const tx = await operations.connect(mfgSigner).triggerRecall(batchId, reason);
    const receipt = await tx.wait();

    const recallTime = new Date().toISOString();
    await runQuery(`INSERT INTO recalls VALUES (?, ?, ?, ?)`, [batchId, mfgSigner.address, reason, recallTime]);

    res.json({
      success: true,
      message: `배치 [${batchId}]에 대한 온체인 리콜이 성공적으로 발령되었습니다.`,
      recall: {
        batchId,
        triggeredBy: mfgSigner.address,
        reason,
        transactionHash: receipt.hash,
        blockNumber: receipt.blockNumber,
        timestamp: recallTime,
        status: "RECALLED"
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 4. 제조사 등록 완제품 목록 API (GET /api/manufacturer/batches/:address)
router.get("/batches/:address", async (req, res) => {
  try {
    const { address } = req.params;
    const batches = await runQuery(
      `SELECT * FROM batches WHERE creator = ? ORDER BY created_at DESC`,
      [address]
    );

    const recalls = await runQuery(`SELECT batch_id FROM recalls`);
    const recalledSet = new Set(recalls.map(r => r.batch_id));

    const result = [];
    for (const b of batches) {
      const parents = await runQuery(`SELECT parent_batch_id FROM genealogy WHERE child_batch_id = ?`, [b.batch_id]);
      result.push({
        ...b,
        parentBatchIds: parents.map(p => p.parent_batch_id),
        isRecalled: recalledSet.has(b.batch_id)
      });
    }

    res.json({ success: true, count: result.length, batches: result });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
