const hre = require("hardhat");
const { ethers } = hre;
const express = require("express");
const cors = require("cors");
const { indexOnChainData } = require("../server/indexer");
const { runQuery } = require("../server/db");
const inspectorRouter = require("../server/routes/inspector");

/**
 * Step 3: 검사기관 전용 웹 포탈 & 검사 불합격 시 온체인 자동 격리(QUARANTINED) 검증 스크립트
 */
async function main() {
  console.log("==========================================================================");
  console.log(" 🧪 ChainTrace Step 3: 검사기관 포탈 & 자동 격리(QUARANTINED) 검증");
  console.log("==========================================================================\n");

  // 1. DuckDB 인덱싱 및 온체인 초기화
  await indexOnChainData();

  // 2. 테스트용 Express 앱 서빙
  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use("/api/inspector", inspectorRouter);

  const server = app.listen(5004, async () => {
    console.log("--------------------------------------------------------------------------");
    console.log("📍 [Step 3-1] 검사기관 포탈 API 서버 포트 5004 바인딩 완료");
    console.log("--------------------------------------------------------------------------");

    const signers = await ethers.getSigners();
    const testInspector = signers[31]; // Inspector #1
    const testBatch1 = "RAW-SUP01-D01";
    const testBatch2 = "RAW-SUP02-D02";

    // 1) 검사 대상 목록 조회
    console.log(" 1) 검사 대상 배치 목록 API 조회...");
    const pendingRes = await fetch("http://localhost:5004/api/inspector/pending-batches");
    const pendingData = await pendingRes.json();

    console.log(` ✅ 검사 대상 배치 목록 조회 성공 (총 ${pendingData.count}개 배치)`);

    // 2) 정상 품질 검사 통과 (PASSED) 수록 테스트
    console.log(`\n 2) 배치 [${testBatch1}] 품질 검사 합격(PASSED) 성적서 서명 수록...`);
    const passRes = await fetch("http://localhost:5004/api/inspector/record-inspection", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        inspectorAddress: testInspector.address,
        batchId: testBatch1,
        isPassed: true,
        certHash: `ipfs://QmCert_Pass_${Date.now()}`,
        testDetails: "잔류농약 320종 불검출, 유효성분 함량 규격 합격"
      })
    });

    const passData = await passRes.json();
    if (!passData.success) {
      throw new Error(`검사 합격 수록 실패: ${passData.message}`);
    }

    console.log(" ✅ 온체인 합격 성적서 수록 성공!");
    console.log(`    - 트랜잭션 해시: ${passData.certificate.transactionHash}`);
    console.log(`    - 최신 배치 상태: ${passData.certificate.updatedBatchStatus}`);

    // 3) 🚨 결함 시나리오 검증: 품질 검사 불합격 (FAILED) 수록 ➔ 온체인 자동 격리(QUARANTINED) 검증
    console.log(`\n 3) 🧪 [결함 시나리오 검증] 배치 [${testBatch2}] 품질 검사 불합격(FAILED) 성적서 수록 시도...`);
    const failRes = await fetch("http://localhost:5004/api/inspector/record-inspection", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        inspectorAddress: testInspector.address,
        batchId: testBatch2,
        isPassed: false,
        certHash: `ipfs://QmCert_Fail_${Date.now()}`,
        testDetails: "🚨 잔류농약 카드뮴 허용기준 초과 검출 (검사 불합격)"
      })
    });

    const failData = await failRes.json();
    if (!failData.success) {
      throw new Error(`검사 불합격 수록 실패: ${failData.message}`);
    }

    console.log(" ✅ 온체인 불합격 성적서 수록 성공!");
    console.log(`    - 트랜잭션 해시 : ${failData.certificate.transactionHash}`);
    console.log(`    - 온체인 전환 상태: ${failData.certificate.updatedBatchStatus}`);

    if (failData.certificate.updatedBatchStatus !== "QUARANTINED") {
      throw new Error(`배치가 QUARANTINED 상태로 변경되지 않았습니다! 실제 상태: ${failData.certificate.updatedBatchStatus}`);
    }

    console.log(" 🎯 검증 성공: 검사 불합격(FAILED) 수록 시 온체인 상태가 즉시 QUARANTINED(격리)로 자동 전환됨!");

    // 4) DuckDB 수록 이력 확인
    console.log("\n 4) DuckDB 검사 성적서 이력 수록 확인...");
    const dbRecords = await runQuery(`SELECT * FROM inspections WHERE batch_id = ? ORDER BY timestamp DESC`, [testBatch2]);
    console.log(` ✅ DuckDB 수록 확인: [${testBatch2}] ${dbRecords[0].is_passed ? "PASSED" : "FAILED"} - ${dbRecords[0].test_details}`);

    server.close(() => {
      console.log("\n==========================================================================");
      console.log(" 🎉 Step 3: 검사기관 웹 무역원장 포탈 & 온체인 자동 격리 검증 100% 성공!");
      console.log("==========================================================================\n");
      setTimeout(() => process.exit(0), 100);
    });
  });
}

main().catch((err) => {
  console.error("❌ Step 3 검증 실패:", err);
  process.exit(1);
});
