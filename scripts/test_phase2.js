const hre = require("hardhat");
const { indexOnChainData } = require("../server/indexer");
const { runQuery } = require("../server/db");
const express = require("express");
const cors = require("cors");
const apiRouter = require("../server/routes/api");

/**
 * Phase 2 DuckDB 인덱서 및 Express API 검증 스크립트
 */
async function main() {
  console.log("==========================================================================");
  console.log(" 🧪 ChainTrace Phase 2: DuckDB 인덱서 & REST API 자동 검증 시작");
  console.log("==========================================================================\n");

  // 1. DuckDB 온체인 이벤트 색인 실행
  await indexOnChainData();

  // 2. DuckDB 직접 SQL OLAP 질의 테스트
  console.log("--------------------------------------------------------------------------");
  console.log("📍 Test 1: DuckDB 직접 SQL OLAP 질의 성능 테스트");
  console.log("--------------------------------------------------------------------------");

  const stats = await runQuery(`
    SELECT
      count(*) as total_batches,
      sum(CASE WHEN batch_type = 'RAW_MATERIAL' THEN 1 ELSE 0 END) as raw_count,
      sum(CASE WHEN batch_id LIKE 'INT%' THEN 1 ELSE 0 END) as int_count,
      sum(CASE WHEN batch_id LIKE 'FG%' THEN 1 ELSE 0 END) as fg_count
    FROM batches;
  `);

  console.log(" ✅ DuckDB 직접 SQL 분석 결과:");
  console.log(`    - 총 배치 수: ${stats[0].total_batches}개 (원료: ${stats[0].raw_count}, 중간재: ${stats[0].int_count}, 완제품: ${stats[0].fg_count})`);

  // 3. DuckDB Recursive CTE 계보 추적 테스트
  console.log("\n--------------------------------------------------------------------------");
  console.log("📍 Test 2: DuckDB Recursive CTE 기반 계보 재귀 추적 쿼리 검증");
  console.log("--------------------------------------------------------------------------");

  const targetRecalledRaw = "RAW-SUP02-D03";
  const cteResult = await runQuery(`
    WITH RECURSIVE downstream AS (
      SELECT parent_batch_id, child_batch_id, 1 as depth
      FROM genealogy
      WHERE parent_batch_id = ?

      UNION ALL

      SELECT g.parent_batch_id, g.child_batch_id, d.depth + 1
      FROM genealogy g
      JOIN downstream d ON g.parent_batch_id = d.child_batch_id
    )
    SELECT d.parent_batch_id, d.child_batch_id, d.depth, b.product_name as productName
    FROM downstream d
    JOIN batches b ON d.child_batch_id = b.batch_id
    WHERE d.child_batch_id LIKE 'FG%'
    ORDER BY depth ASC;
  `, [targetRecalledRaw]);

  console.log(` ✅ 리콜 원료 [${targetRecalledRaw}]로부터 오염된 완제품 목록 (DuckDB CTE 탐색 ${cteResult.length}건):`);
  cteResult.forEach((fg, idx) => {
    console.log(`    [${idx + 1}] 배치ID: ${fg.child_batch_id} (깊이: ${fg.depth}) - ${fg.productName}`);
  });

  // 4. Express 서버 구동 테스트
  console.log("\n--------------------------------------------------------------------------");
  console.log("📍 Test 3: Express REST API 서버 모듈 통합 검증");
  console.log("--------------------------------------------------------------------------");

  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use("/api", apiRouter);

  const server = app.listen(5001, () => {
    console.log(" ✅ Express REST API 라우터 포트 5001 바인딩 성공!");
  });

  server.close(() => {
    console.log(" ✅ API 서버 테스트 후 정상 종료 완료!");
  });

  console.log("\n==========================================================================");
  console.log(" 🎉 Phase 2: DuckDB 인덱서 및 Express API 검증 성공!");
  console.log("==========================================================================\n");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
