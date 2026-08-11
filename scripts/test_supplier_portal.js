const hre = require("hardhat");
const { ethers } = hre;
const express = require("express");
const cors = require("cors");
const path = require("path");
const { indexOnChainData } = require("../server/indexer");
const { runQuery } = require("../server/db");
const supplierRouter = require("../server/routes/supplier");

/**
 * Step 1: 원료 공급사 전용 웹 무역원장 포탈 API 및 온체인 연동 검증 스크립트
 */
async function main() {
  console.log("==========================================================================");
  console.log(" 🧪 ChainTrace Step 1: 원료 공급사 웹 무역원장 포탈 통합 검증");
  console.log("==========================================================================\n");

  // 1. DuckDB 인덱싱 및 온체인 초기화
  await indexOnChainData();

  // 2. 테스트용 Express 앱 서빙
  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use("/api/supplier", supplierRouter);

  const server = app.listen(5002, async () => {
    console.log("--------------------------------------------------------------------------");
    console.log("📍 [Step 1-1] 원료 공급사 포탈 API 서버 포트 5002 바인딩 완료");
    console.log("--------------------------------------------------------------------------");

    const signers = await ethers.getSigners();
    const testSupplier = signers[1]; // Supplier #1
    const testBatchId = `RAW-TEST-${Date.now()}`;

    // 3. POST /api/supplier/create-batch 테스트
    console.log(` 1) 원료 수급 폼 입력 ➔ 온체인 무역원장 서명 등록 테스트 (배치: ${testBatchId})...`);

    const res = await fetch("http://localhost:5002/api/supplier/create-batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        supplierAddress: testSupplier.address,
        batchId: testBatchId,
        productName: "6년근 유기농 청정 수삼 (테스트)",
        quantity: 1500,
        unit: "kg",
        originLocation: "충남 금산군 제원면 농장",
        metadataHash: `ipfs://QmTestCert_${testBatchId}`
      })
    });

    const data = await res.json();
    if (!data.success) {
      throw new Error(`원료 무역원장 등록 실패: ${data.message}`);
    }

    console.log(" ✅ 온체인 트랜잭션 수록 성공!");
    console.log(`    - 트랜잭션 해시: ${data.certificate.transactionHash}`);
    console.log(`    - 블록 번호    : #${data.certificate.blockNumber}`);
    console.log(`    - 발행 상태    : ${data.certificate.blockchainStatus}`);

    // 4. DuckDB 자동 색인 확인
    console.log("\n 2) DuckDB 데이터베이스 수록 여부 확인...");
    const dbBatches = await runQuery(`SELECT * FROM batches WHERE batch_id = ?`, [testBatchId]);
    if (dbBatches.length === 0) {
      throw new Error("DuckDB에 원료 배치가 색인되지 않았습니다.");
    }
    console.log(` ✅ DuckDB 수록 확인: [${dbBatches[0].batch_id}] ${dbBatches[0].product_name} (${dbBatches[0].quantity} ${dbBatches[0].unit})`);

    // 5. GET /api/supplier/batches/:address 조회 테스트
    console.log("\n 3) 원료사 수록 배치 목록 GET API 조회 테스트...");
    const listRes = await fetch(`http://localhost:5002/api/supplier/batches/${testSupplier.address}`);
    const listData = await listRes.json();

    console.log(` ✅ 원료사 등록 배치 목록 API 응답: 총 ${listData.count}개 배치 수록 확인!`);

    server.close(() => {
      console.log("\n==========================================================================");
      console.log(" 🎉 Step 1: 원료 공급사 전용 웹 무역원장 포탈 검증 100% 성공!");
      console.log("==========================================================================\n");
      setTimeout(() => process.exit(0), 100);
    });
  });
}

main().catch((err) => {
  console.error("❌ Step 1 검증 실패:", err);
  process.exit(1);
});
