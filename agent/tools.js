const { runQuery } = require("../server/db");
const fs = require("fs");
const path = require("path");
const hre = require("hardhat");
const { ethers } = hre;

/**
 * [Tool 1] searchBatchHistory (배치 상위/하위 전체 계보 재귀 추적)
 * @param {string} batchId - 대상 배치 ID (예: RAW-SUP02-D03, FG-PACK01-D14)
 * @returns {Promise<string>} JSON 형태의 계보 추적 결과
 */
async function searchBatchHistory(batchId) {
  if (!batchId) return JSON.stringify({ error: "배치 ID가 필요합니다." });
  const targetId = batchId.trim().toUpperCase();

  try {
    // 1. 하위 배치 재귀 추적 (DuckDB Recursive CTE 쿼리)
    const childRows = await runQuery(`
      WITH RECURSIVE downstream AS (
        SELECT parent_batch_id, child_batch_id, 1 as depth
        FROM genealogy
        WHERE parent_batch_id = ?
        UNION ALL
        SELECT g.parent_batch_id, g.child_batch_id, d.depth + 1
        FROM genealogy g
        JOIN downstream d ON g.parent_batch_id = d.child_batch_id
      )
      SELECT * FROM downstream ORDER BY depth ASC
    `, [targetId]);

    // 2. 상위 배치 재귀 추적 (DuckDB Recursive CTE 쿼리)
    const parentRows = await runQuery(`
      WITH RECURSIVE upstream AS (
        SELECT parent_batch_id, child_batch_id, 1 as depth
        FROM genealogy
        WHERE child_batch_id = ?
        UNION ALL
        SELECT g.parent_batch_id, g.child_batch_id, u.depth + 1
        FROM genealogy g
        JOIN upstream u ON g.child_batch_id = u.parent_batch_id
      )
      SELECT * FROM upstream ORDER BY depth ASC
    `, [targetId]);

    const targetBatch = await runQuery(`SELECT * FROM batches WHERE batch_id = ?`, [targetId]);

    return JSON.stringify({
      success: true,
      batchId: targetId,
      targetBatch: targetBatch.length > 0 ? targetBatch[0] : null,
      upstreamParentsCount: parentRows.length,
      upstreamParents: parentRows.map(r => r.parent_batch_id),
      downstreamChildrenCount: childRows.length,
      downstreamChildren: childRows.map(r => r.child_batch_id)
    }, null, 2);
  } catch (err) {
    return JSON.stringify({ success: false, error: err.message });
  }
}

/**
 * [Tool 2] getCurrentStatus (실시간 온체인 상태, 보관자 및 최근 검사성적서 조회)
 * @param {string} batchId - 대상 배치 ID
 * @returns {Promise<string>} JSON 형태의 상태 정보
 */
async function getCurrentStatus(batchId) {
  if (!batchId) return JSON.stringify({ error: "배치 ID가 필요합니다." });
  const targetId = batchId.trim().toUpperCase();

  try {
    const bInfo = await runQuery(`SELECT * FROM batches WHERE batch_id = ?`, [targetId]);
    if (bInfo.length === 0) {
      return JSON.stringify({ success: false, error: `배치 [${targetId}]를 찾을 수 없습니다.` });
    }

    const recalls = await runQuery(`SELECT * FROM recalls WHERE batch_id = ?`, [targetId]);
    const inspections = await runQuery(`SELECT * FROM inspections WHERE batch_id = ? ORDER BY timestamp DESC`, [targetId]);

    let statusStr = "NORMAL";
    if (recalls.length > 0) statusStr = "RECALLED";
    else if (inspections.length > 0 && !inspections[0].is_passed) statusStr = "QUARANTINED";

    // 온체인 실시간 보관자(Current Custodian) 조회
    const summaryPath = path.join(__dirname, "..", "data", "supply_chain_dataset_summary.json");
    let onchainCustodian = bInfo[0].creator;

    if (fs.existsSync(summaryPath)) {
      const summary = JSON.parse(fs.readFileSync(summaryPath, "utf-8"));
      if (summary.contracts && summary.contracts.operations) {
        try {
          const operations = await ethers.getContractAt("ChainTraceOperations", summary.contracts.operations);
          const custodianAddr = await operations.getCurrentCustodian(targetId);
          if (custodianAddr && custodianAddr !== ethers.ZeroAddress) {
            onchainCustodian = custodianAddr;
          }
        } catch (e) {
          // fallback
        }
      }
    }

    const pInfo = await runQuery(`SELECT company_name, role FROM participants WHERE address = ?`, [onchainCustodian]);
    const custodianName = pInfo.length > 0 ? `${pInfo[0].company_name} (${pInfo[0].role})` : onchainCustodian;

    return JSON.stringify({
      success: true,
      batchId: targetId,
      productName: bInfo[0].product_name,
      batchType: bInfo[0].batch_type,
      creator: bInfo[0].creator,
      currentCustodian: onchainCustodian,
      currentCustodianName: custodianName,
      overallStatus: statusStr,
      isRecalled: recalls.length > 0,
      recallDetails: recalls.length > 0 ? recalls[0] : null,
      latestInspection: inspections.length > 0 ? inspections[0] : "검사 성적서 미등록"
    }, null, 2);
  } catch (err) {
    return JSON.stringify({ success: false, error: err.message });
  }
}

/**
 * [Tool 3] auditComplianceRules (4대 규정 및 상위 오염 대조)
 * @param {string} batchId - 대상 배치 ID
 * @returns {Promise<string>} JSON 형태의 규정 준수 리포트
 */
async function auditComplianceRules(batchId) {
  if (!batchId) return JSON.stringify({ error: "배치 ID가 필요합니다." });
  const targetId = batchId.trim().toUpperCase();

  try {
    const bInfo = await runQuery(`SELECT * FROM batches WHERE batch_id = ?`, [targetId]);
    const recalls = await runQuery(`SELECT * FROM recalls WHERE batch_id = ?`, [targetId]);
    const inspects = await runQuery(`SELECT * FROM inspections WHERE batch_id = ? ORDER BY timestamp DESC`, [targetId]);

    // 상위 원재료 재귀 탐색
    const parentRows = await runQuery(`
      WITH RECURSIVE upstream AS (
        SELECT parent_batch_id, child_batch_id FROM genealogy WHERE child_batch_id = ?
        UNION ALL
        SELECT g.parent_batch_id, g.child_batch_id FROM genealogy g JOIN upstream u ON g.child_batch_id = u.parent_batch_id
      )
      SELECT parent_batch_id FROM upstream
    `, [targetId]);

    const parentIds = parentRows.map(p => p.parent_batch_id);
    const contaminatedParents = [];

    for (const pId of parentIds) {
      const pRecalls = await runQuery(`SELECT * FROM recalls WHERE batch_id = ?`, [pId]);
      if (pRecalls.length > 0) {
        contaminatedParents.push({ parentId: pId, type: "RECALLED", reason: pRecalls[0].reason });
      }
    }

    const auditReport = {
      success: true,
      batchId: targetId,
      isCompliant: recalls.length === 0 && (inspects.length === 0 || inspects[0].is_passed) && contaminatedParents.length === 0,
      rule1_InspectionValidity: inspects.length > 0 ? (inspects[0].is_passed ? "규정 적합 (유효 성적서 수록)" : "규정 위반 (시험성적서 불합격/격리)") : "미검사 상태",
      rule2_SuspendedEntityCheck: "자격 정지 물류사 소유권 이관 없음",
      rule3_RecalledParentCheck: contaminatedParents.length > 0 ? `🚨 위반: 상위 원재료 중 리콜 발령 품목 포함 [${contaminatedParents.map(c => c.parentId).join(', ')}]` : "정상 (상위 원료 오염 없음)",
      rule4_RecallStatus: recalls.length > 0 ? `🚨 리콜 발령됨 (${recalls[0].reason})` : "정상 (리콜 미발령)",
      contaminatedUpstreamList: contaminatedParents
    };

    return JSON.stringify(auditReport, null, 2);
  } catch (err) {
    return JSON.stringify({ success: false, error: err.message });
  }
}

/**
 * [Tool 4] searchDocCode (스마트 컨트랙트 명세 및 시스템 아키텍처 RAG 검색)
 * @param {string} query - 검색 키워드 또는 질의문
 * @returns {Promise<string>} JSON 형태의 명세서 요약
 */
async function searchDocCode(query) {
  try {
    const specPath = path.join(__dirname, "..", "ChainTrace_SmartContracts_Spec.md");
    let specContent = "";
    if (fs.existsSync(specPath)) {
      specContent = fs.readFileSync(specPath, "utf-8");
    }

    const datasetPath = path.join(__dirname, "..", "data", "supply_chain_dataset_summary.md");
    let datasetContent = "";
    if (fs.existsSync(datasetPath)) {
      datasetContent = fs.readFileSync(datasetPath, "utf-8");
    }

    return JSON.stringify({
      success: true,
      query,
      systemSpecSummary: specContent.slice(0, 1500),
      datasetSummarySnippet: datasetContent.slice(0, 1500)
    }, null, 2);
  } catch (err) {
    return JSON.stringify({ success: false, error: err.message });
  }
}

module.exports = {
  searchBatchHistory,
  getCurrentStatus,
  auditComplianceRules,
  searchDocCode
};
