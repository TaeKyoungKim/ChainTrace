const express = require("express");
const router = express.Router();
const hre = require("hardhat");
const { ethers } = hre;
const { runQuery } = require("../db");
const fs = require("fs");
const path = require("path");

// 1. 공급망 통계 API (DuckDB OLAP 분석)
router.get("/stats", async (req, res) => {
  try {
    const totalBatches = await runQuery(`SELECT count(*) as count FROM batches`);
    const rawBatches = await runQuery(`SELECT count(*) as count FROM batches WHERE batch_type = 'RAW_MATERIAL'`);
    const intBatches = await runQuery(`SELECT count(*) as count FROM batches WHERE batch_id LIKE 'INT%'`);
    const fgBatches = await runQuery(`SELECT count(*) as count FROM batches WHERE batch_id LIKE 'FG%'`);
    const totalParticipants = await runQuery(`SELECT count(*) as count FROM participants`);
    const totalInspections = await runQuery(`SELECT count(*) as count FROM inspections`);
    const failedInspections = await runQuery(`SELECT count(*) as count FROM inspections WHERE is_passed = false`);
    const totalRecalls = await runQuery(`SELECT count(*) as count FROM recalls`);

    res.json({
      success: true,
      database: "DuckDB (Columnar OLAP Engine)",
      stats: {
        totalBatches: Number(totalBatches[0].count),
        rawBatches: Number(rawBatches[0].count),
        intermediateBatches: Number(intBatches[0].count),
        finishedGoodsBatches: Number(fgBatches[0].count),
        totalParticipants: Number(totalParticipants[0].count),
        totalInspections: Number(totalInspections[0].count),
        failedInspections: Number(failedInspections[0].count),
        failureRatePercentage: ((Number(failedInspections[0].count) / Number(totalInspections[0].count)) * 100).toFixed(2),
        totalRecalls: Number(totalRecalls[0].count)
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 2. 40개 참여 기업 목록 API
router.get("/participants", async (req, res) => {
  try {
    const participants = await runQuery(`SELECT * FROM participants ORDER BY registered_at ASC`);
    res.json({ success: true, count: participants.length, participants });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 3. 전체/조건별 배치 목록 API
router.get("/batches", async (req, res) => {
  try {
    const { type } = req.query;
    let sql = `SELECT * FROM batches`;
    const params = [];
    if (type) {
      sql += ` WHERE batch_type = ?`;
      params.push(type);
    }
    sql += ` ORDER BY created_at DESC`;

    const batches = await runQuery(sql, params);
    res.json({ success: true, count: batches.length, batches });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 4. 단일 배치 상세 정보 & 검사 성적서 & 상태 API
router.get("/batch/:id", async (req, res) => {
  try {
    const batchId = req.params.id;
    const batchRows = await runQuery(`SELECT * FROM batches WHERE batch_id = ?`, [batchId]);
    if (batchRows.length === 0) {
      return res.status(404).json({ success: false, message: "배치를 찾을 수 없습니다." });
    }

    const batch = batchRows[0];

    // 상위 계보 부모 ID 조회
    const parents = await runQuery(`SELECT parent_batch_id FROM genealogy WHERE child_batch_id = ?`, [batchId]);
    batch.parentBatchIds = parents.map(p => p.parent_batch_id);

    // 검사 성적서 이력 조회
    const inspections = await runQuery(`SELECT * FROM inspections WHERE batch_id = ? ORDER BY timestamp DESC`, [batchId]);
    batch.inspections = inspections;

    // 리콜 및 상태 정보
    const recalls = await runQuery(`SELECT * FROM recalls WHERE batch_id = ?`, [batchId]);
    batch.isRecalled = recalls.length > 0;
    batch.recallDetails = recalls.length > 0 ? recalls[0] : null;

    // 실시간 온체인 보관자 조회
    const summaryPath = path.join(__dirname, "..", "..", "data", "supply_chain_dataset_summary.json");
    if (fs.existsSync(summaryPath)) {
      const summary = JSON.parse(fs.readFileSync(summaryPath, "utf-8"));
      const operations = await ethers.getContractAt("ChainTraceOperations", summary.contracts.operations);
      const custodianAddr = await operations.getCurrentCustodian(batchId);

      // 보관자 매핑 정보
      const custEntity = await runQuery(`SELECT company_name, role FROM participants WHERE address = ?`, [custodianAddr]);
      batch.currentCustodian = {
        address: custodianAddr,
        companyName: custEntity.length > 0 ? custEntity[0].company_name : "UNKNOWN",
        role: custEntity.length > 0 ? custEntity[0].role : "UNKNOWN"
      };
    }

    res.json({ success: true, batch });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 5. 🔥 DuckDB Recursive CTE 기반 고속 계보 재귀 추적 API (AI Agent 전용 핵심 도구)
router.get("/trace/genealogy/:id", async (req, res) => {
  try {
    const targetBatchId = req.params.id;

    // DuckDB Recursive CTE: 하위 방향 (Downstream Child Trace: target -> INT -> FG)
    const downstreamQuery = `
      WITH RECURSIVE downstream AS (
        SELECT parent_batch_id, child_batch_id, 1 as depth
        FROM genealogy
        WHERE parent_batch_id = ?

        UNION ALL

        SELECT g.parent_batch_id, g.child_batch_id, d.depth + 1
        FROM genealogy g
        JOIN downstream d ON g.parent_batch_id = d.child_batch_id
      )
      SELECT d.parent_batch_id, d.child_batch_id, d.depth, b.product_name as productName, b.batch_type as batchType
      FROM downstream d
      JOIN batches b ON d.child_batch_id = b.batch_id
      ORDER BY depth ASC;
    `;

    const downstreamTree = await runQuery(downstreamQuery, [targetBatchId]);

    // DuckDB Recursive CTE: 상위 방향 (Upstream Parent Trace: target <- INT <- RAW)
    const upstreamQuery = `
      WITH RECURSIVE upstream AS (
        SELECT parent_batch_id, child_batch_id, 1 as depth
        FROM genealogy
        WHERE child_batch_id = ?

        UNION ALL

        SELECT g.parent_batch_id, g.child_batch_id, u.depth + 1
        FROM genealogy g
        JOIN upstream u ON g.child_batch_id = u.parent_batch_id
      )
      SELECT u.parent_batch_id, u.child_batch_id, u.depth, b.product_name, b.batch_type
      FROM upstream u
      JOIN batches b ON u.parent_batch_id = b.batch_id
      ORDER BY depth ASC;
    `;

    const upstreamTree = await runQuery(upstreamQuery, [targetBatchId]);

    // 영향 받은 최종 완제품 (FG-%) 필터링
    const affectedFinishedGoods = downstreamTree.filter(item => item.child_batch_id.startsWith("FG"));

    res.json({
      success: true,
      targetBatchId,
      summary: {
        upstreamCount: upstreamTree.length,
        downstreamCount: downstreamTree.length,
        affectedFinishedGoodsCount: affectedFinishedGoods.length
      },
      upstreamTree,
      downstreamTree,
      affectedFinishedGoods
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
