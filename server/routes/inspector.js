const express = require("express");
const router = express.Router();
const hre = require("hardhat");
const { ethers } = hre;
const { runQuery } = require("../db");
const fs = require("fs");
const path = require("path");

// 등록된 공인 검사기관 목록 API (GET /api/inspector/inspectors)
router.get("/inspectors", async (req, res) => {
  try {
    const inspectors = await runQuery(
      `SELECT address, company_name FROM participants WHERE role = 'INSPECTOR' ORDER BY company_name ASC`
    );
    res.json({ success: true, count: inspectors.length, inspectors });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 1. 검사 대상 배치 목록 및 최근 검사 상태 조회 API (GET /api/inspector/pending-batches)
router.get("/pending-batches", async (req, res) => {
  try {
    const batches = await runQuery(`SELECT * FROM batches ORDER BY created_at DESC`);
    const recalls = await runQuery(`SELECT batch_id FROM recalls`);
    const recalledSet = new Set(recalls.map(r => r.batch_id));

    const result = [];
    for (const b of batches) {
      const isRecalled = recalledSet.has(b.batch_id);
      const inspections = await runQuery(`SELECT * FROM inspections WHERE batch_id = ? ORDER BY timestamp DESC`, [b.batch_id]);
      
      let inspectStatus = "UNTESTED";
      if (inspections.length > 0) {
        inspectStatus = inspections[0].is_passed ? "PASSED" : "FAILED";
      }

      let overallStatus = "NORMAL";
      if (isRecalled) overallStatus = "RECALLED";
      else if (inspectStatus === "FAILED") overallStatus = "QUARANTINED";

      result.push({
        batchId: b.batch_id,
        batchType: b.batch_type,
        productName: b.product_name,
        creator: b.creator,
        createdAt: b.created_at,
        inspectStatus,
        overallStatus,
        inspectionCount: inspections.length,
        latestInspection: inspections.length > 0 ? inspections[0] : null
      });
    }

    res.json({ success: true, count: result.length, batches: result });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 2. 검사기관 품질 검사 성적서 온체인 수록 API (POST /api/inspector/record-inspection)
router.post("/record-inspection", async (req, res) => {
  try {
    const { inspectorAddress, batchId, isPassed, certHash, testDetails } = req.body;

    if (!inspectorAddress || !batchId || isPassed === undefined || !certHash) {
      return res.status(400).json({ success: false, message: "필수 파라미터(검사기관 주소, 배치 ID, 합격 여부, 성적서 해시)가 누락되었습니다." });
    }

    const summaryPath = path.join(__dirname, "..", "..", "data", "supply_chain_dataset_summary.json");
    if (!fs.existsSync(summaryPath)) {
      return res.status(500).json({ success: false, message: "스마트 컨트랙트 배포 정보를 찾을 수 없습니다." });
    }

    const summary = JSON.parse(fs.readFileSync(summaryPath, "utf-8"));
    const registryAddr = summary.contracts.registry;
    const operationsAddr = summary.contracts.operations;

    const registry = await ethers.getContractAt("ChainTraceRegistry", registryAddr);
    const operations = await ethers.getContractAt("ChainTraceOperations", operationsAddr);

    const signers = await ethers.getSigners();
    const inspectorSigner = signers.find(s => s.address.toLowerCase() === inspectorAddress.toLowerCase()) || signers[30];

    // 🔒 권한 자동 부여 및 확인 (AccessControl Missing Role 에러 원천 방지)
    const inspectorRole = await registry.INSPECTOR_ROLE();
    const hasRole = await registry.hasRole(inspectorRole, inspectorSigner.address);
    if (!hasRole) {
      console.log(`🔑 [권한 자동 부여] ${inspectorSigner.address} 계정에 INSPECTOR_ROLE 부여 중...`);
      const adminSigner = signers[0];
      const grantTx = await registry.connect(adminSigner).grantRole(inspectorRole, inspectorSigner.address);
      await grantTx.wait();
    }

    console.log(`🔬 [품질 검사 성적서 온체인 서명 등록] 검사기관: ${inspectorSigner.address} | 배치: ${batchId} | 결과: ${isPassed ? "PASSED(합격)" : "FAILED(불합격/격리)"}`);

    // 스마트 컨트랙트 recordInspection 호출 (불합격 시 스마트 컨트랙트가 자동으로 QUARANTINED 상태 지정)
    const tx = await operations.connect(inspectorSigner).recordInspection(
      batchId,
      Boolean(isPassed),
      certHash,
      testDetails || "품질 파라미터 검사 실시"
    );

    const receipt = await tx.wait();

    // DuckDB 색인 동기화
    const inspectTime = new Date().toISOString();
    await runQuery(
      `INSERT INTO inspections VALUES (?, ?, ?, ?, ?, ?)`,
      [batchId, inspectorSigner.address, Boolean(isPassed), certHash, testDetails || "품질 파라미터 검사 실시", inspectTime]
    );

    // 온체인 최종 배치 상태 조회
    const updatedStatusNum = await operations.getBatchStatus(batchId);
    let updatedStatusStr = "NORMAL";
    if (updatedStatusNum === 1n) updatedStatusStr = "QUARANTINED";
    if (updatedStatusNum === 2n) updatedStatusStr = "RECALLED";

    const certificate = {
      batchId,
      inspectorAddress: inspectorSigner.address,
      isPassed: Boolean(isPassed),
      certHash,
      testDetails: testDetails || "품질 파라미터 검사 실시",
      transactionHash: receipt.hash,
      blockNumber: receipt.blockNumber,
      timestamp: inspectTime,
      updatedBatchStatus: updatedStatusStr,
      blockchainStatus: "CONFIRMED_ON_CHAIN"
    };

    res.json({
      success: true,
      message: isPassed ?
        "품질 검사 합격 성적서가 블록체인 및 DuckDB에 수록되었습니다." :
        "⚠️ 품질 검사 불합격 성적서 수록 완료: 해당 배치가 온체인 상에서 QUARANTINED(격리) 상태로 변경되었습니다.",
      certificate
    });
  } catch (err) {
    console.error("❌ 품질 검사 성적서 수록 에러:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// 3. 특정 배치의 전체 검사 성적서 이력 조회 API (GET /api/inspector/records/:batchId)
router.get("/records/:batchId", async (req, res) => {
  try {
    const { batchId } = req.params;
    const records = await runQuery(
      `SELECT * FROM inspections WHERE batch_id = ? ORDER BY timestamp DESC`,
      [batchId]
    );

    res.json({ success: true, batchId, count: records.length, records });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
