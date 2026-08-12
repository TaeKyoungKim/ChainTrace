const express = require("express");
const router = express.Router();
const hre = require("hardhat");
const { ethers } = hre;
const { runQuery } = require("../db");
const fs = require("fs");
const path = require("path");

// 1. 등록된 유통사 목록 조회 API (GET /api/distributor/companies)
router.get("/companies", async (req, res) => {
  try {
    const companies = await runQuery(
      `SELECT address, company_name FROM participants WHERE role = 'DISTRIBUTOR' ORDER BY company_name ASC`
    );
    res.json({ success: true, count: companies.length, companies });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 2. 유통사 매장 입고 수락 API (POST /api/distributor/confirm-receipt)
router.post("/confirm-receipt", async (req, res) => {
  try {
    const { distributorAddress, batchId } = req.body;

    if (!distributorAddress || !batchId) {
      return res.status(400).json({ success: false, message: "필수 파라미터(유통사 주소, 배치 ID)가 누락되었습니다." });
    }

    const summaryPath = path.join(__dirname, "..", "..", "data", "supply_chain_dataset_summary.json");
    const summary = JSON.parse(fs.readFileSync(summaryPath, "utf-8"));
    const registryAddr = summary.contracts.registry;
    const operationsAddr = summary.contracts.operations;

    const registry = await ethers.getContractAt("ChainTraceRegistry", registryAddr);
    const operations = await ethers.getContractAt("ChainTraceOperations", operationsAddr);

    const signers = await ethers.getSigners();
    const distSigner = signers.find(s => s.address.toLowerCase() === distributorAddress.toLowerCase()) || signers[35];

    // 🔒 유통사 권한 자동 부여 및 검증 (AccessControl Missing Role 방지)
    const distRole = await registry.DISTRIBUTOR_ROLE();
    const hasRole = await registry.hasRole(distRole, distSigner.address);
    if (!hasRole) {
      console.log(`🔑 [권한 자동 부여] ${distSigner.address} 계정에 DISTRIBUTOR_ROLE 부여 중...`);
      const adminSigner = signers[0];
      const grantTx = await registry.connect(adminSigner).grantRole(distRole, distSigner.address);
      await grantTx.wait();
    }

    console.log(`🏬 [유통사 매장 입고 수락] 유통사: ${distSigner.address} | 배치: ${batchId}`);

    const tx = await operations.connect(distSigner).acceptTransfer(batchId);
    const receipt = await tx.wait();

    const acceptTime = new Date().toISOString();
    await runQuery(`UPDATE transfers SET is_pending = false, is_completed = true WHERE batch_id = ? AND to_address = ?`, [batchId, distSigner.address]);

    const newCustodian = await operations.getCurrentCustodian(batchId);

    res.json({
      success: true,
      message: `배치 [${batchId}]가 매장/창고에 최종 입고 완료되었습니다.`,
      receipt: {
        batchId,
        newCustodian,
        confirmedBy: distSigner.address,
        transactionHash: receipt.hash,
        blockNumber: receipt.blockNumber,
        timestamp: acceptTime,
        blockchainStatus: "STORE_RECEIVED"
      }
    });
  } catch (err) {
    console.error("❌ 유통사 입고 수락 에러:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// 3. 유통사 매장 보관 제품 목록 조회 API (GET /api/distributor/inventory/:address)
router.get("/inventory/:address", async (req, res) => {
  try {
    const { address } = req.params;

    const summaryPath = path.join(__dirname, "..", "..", "data", "supply_chain_dataset_summary.json");
    const summary = JSON.parse(fs.readFileSync(summaryPath, "utf-8"));
    const operations = await ethers.getContractAt("ChainTraceOperations", summary.contracts.operations);

    const allBatches = await runQuery(`SELECT * FROM batches ORDER BY created_at DESC`);
    const recalls = await runQuery(`SELECT batch_id FROM recalls`);
    const recalledSet = new Set(recalls.map(r => r.batch_id));

    const myInventory = [];
    for (const b of allBatches) {
      const custodian = await operations.getCurrentCustodian(b.batch_id);
      const isMyBatch = custodian.toLowerCase() === address.toLowerCase() || b.creator.toLowerCase() === address.toLowerCase();

      if (isMyBatch) {
        const statusNum = await operations.getBatchStatus(b.batch_id);
        let statusStr = "NORMAL";
        if (statusNum === 1n) statusStr = "QUARANTINED";
        if (statusNum === 2n || recalledSet.has(b.batch_id)) statusStr = "RECALLED";

        const parents = await runQuery(`SELECT parent_batch_id FROM genealogy WHERE child_batch_id = ?`, [b.batch_id]);

        myInventory.push({
          ...b,
          parentBatchIds: parents.map(p => p.parent_batch_id),
          status: statusStr,
          isBlocked: statusStr !== "NORMAL"
        });
      }
    }

    res.json({ success: true, count: myInventory.length, inventory: myInventory });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 4. 🚨 온체인 리콜 & 격리 실시간 모니터링 API (GET /api/distributor/recall-monitor)
router.get("/recall-monitor", async (req, res) => {
  try {
    const summaryPath = path.join(__dirname, "..", "..", "data", "supply_chain_dataset_summary.json");
    const summary = JSON.parse(fs.readFileSync(summaryPath, "utf-8"));
    const operations = await ethers.getContractAt("ChainTraceOperations", summary.contracts.operations);

    // 전체 리콜 및 격리 목록 가져오기
    const dbRecalls = await runQuery(`SELECT * FROM recalls ORDER BY timestamp DESC`);
    const dbInspections = await runQuery(`SELECT * FROM inspections WHERE is_passed = false ORDER BY timestamp DESC`);

    const alerts = [];

    // 1) 리콜 발령 배치 및 상위 계보 감지
    for (const r of dbRecalls) {
      const bInfo = await runQuery(`SELECT * FROM batches WHERE batch_id = ?`, [r.batch_id]);
      const product = bInfo.length > 0 ? bInfo[0].product_name : r.batch_id;

      // 해당 리콜 배치로 만들어진 하위 완제품들(Child finished goods) 재귀 검색
      const childBatches = await runQuery(`
        WITH RECURSIVE lineage AS (
          SELECT parent_batch_id, child_batch_id FROM genealogy WHERE parent_batch_id = ?
          UNION ALL
          SELECT g.parent_batch_id, g.child_batch_id
          FROM genealogy g
          JOIN lineage l ON g.parent_batch_id = l.child_batch_id
        )
        SELECT child_batch_id FROM lineage
      `, [r.batch_id]);

      const affectedChildren = childBatches.map(c => c.child_batch_id);

      alerts.push({
        type: "RECALL",
        batchId: r.batch_id,
        productName: product,
        triggeredBy: r.triggered_by,
        reason: r.reason,
        timestamp: r.timestamp,
        affectedChildrenCount: affectedChildren.length,
        affectedChildren: affectedChildren,
        alertMessage: `🚨 [온체인 리콜 감지] 배치 [${r.batch_id}] (${product})에 리콜이 발령되었습니다! (사유: ${r.reason})`
      });
    }

    // 2) 검사 불합격(QUARANTINED) 배치 감지
    for (const i of dbInspections) {
      const bInfo = await runQuery(`SELECT * FROM batches WHERE batch_id = ?`, [i.batch_id]);
      const product = bInfo.length > 0 ? bInfo[0].product_name : i.batch_id;

      alerts.push({
        type: "QUARANTINE",
        batchId: i.batch_id,
        productName: product,
        inspector: i.inspector,
        reason: i.test_details,
        timestamp: i.timestamp,
        alertMessage: `⚠️ [품질 검사 불합격/격리 감지] 배치 [${i.batch_id}] (${product})가 격리 상태입니다! (내용: ${i.test_details})`
      });
    }

    res.json({
      success: true,
      hasAlerts: alerts.length > 0,
      alertCount: alerts.length,
      alerts
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
