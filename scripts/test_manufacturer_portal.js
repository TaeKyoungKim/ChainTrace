const hre = require("hardhat");
const { ethers } = hre;
const express = require("express");
const cors = require("cors");
const { indexOnChainData } = require("../server/indexer");
const { runQuery } = require("../server/db");
const manufacturerRouter = require("../server/routes/manufacturer");

/**
 * Step 2: 제조사 전용 웹 무역원장 포탈 & 리콜/격리 차단 및 발령 검증 스크립트
 */
async function main() {
  console.log("==========================================================================");
  console.log(" 🧪 ChainTrace Step 2: 제조사 웹 무역원장 포탈 & 결함 시나리오 차단 검증");
  console.log("==========================================================================\n");

  // 1. DuckDB 인덱싱 및 온체인 초기화
  await indexOnChainData();

  // 2. 테스트용 Express 앱 서빙
  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use("/api/manufacturer", manufacturerRouter);

  const server = app.listen(5003, async () => {
    console.log("--------------------------------------------------------------------------");
    console.log("📍 [Step 2-1] 제조사 포탈 API 서버 포트 5003 바인딩 완료");
    console.log("--------------------------------------------------------------------------");

    const signers = await ethers.getSigners();
    const testManufacturer = signers[11]; // Manufacturer #1
    const testMfgBatchId = `MFG-TEST-${Date.now()}`;

    // 1) 원료 목록 조회
    console.log(" 1) 투입 가능 원료 배치 목록 API 조회...");
    const rawRes = await fetch("http://localhost:5003/api/manufacturer/raw-batches");
    const rawData = await rawRes.json();

    const normalRaw = rawData.rawBatches.find(r => r.status === "NORMAL");
    const recalledRaw = rawData.rawBatches.find(r => r.status === "RECALLED");

    console.log(` ✅ 정상 원료 배치 확인: [${normalRaw.batchId}] (${normalRaw.productName})`);
    if (recalledRaw) {
      console.log(` 🚨 리콜 원료 배치 확인: [${recalledRaw.batchId}] (${recalledRaw.productName})`);
    }

    // 2) 정상 원료를 투입하여 완제품 제조 무역원장 수록
    console.log(`\n 2) 정상 원료 [${normalRaw.batchId}] 투입 ➔ 완제품 [${testMfgBatchId}] 제조 서명 수록...`);
    const createRes = await fetch("http://localhost:5003/api/manufacturer/create-batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        manufacturerAddress: testManufacturer.address,
        batchId: testMfgBatchId,
        productName: "6년근 홍삼정 스틱 (테스트)",
        quantity: 500,
        unit: "box",
        parentBatchIds: [normalRaw.batchId],
        metadataHash: `ipfs://QmTestMfgMeta_${testMfgBatchId}`
      })
    });

    const createData = await createRes.json();
    if (!createData.success) {
      throw new Error(`완제품 제조 수록 실패: ${createData.message}`);
    }

    console.log(" ✅ 온체인 완제품 무역원장 수록 성공!");
    console.log(`    - 트랜잭션 해시 : ${createData.certificate.transactionHash}`);
    console.log(`    - 연결된 원료   : ${createData.certificate.parentBatchIds.join(", ")}`);

    // 3) 🚨 결함 시나리오 검증: 리콜 조치된 원료 투입 시도 ➔ 제조 차단 검증
    if (recalledRaw) {
      console.log(`\n 3) 🧪 [시나리오 차단 검증] 리콜 원료 [${recalledRaw.batchId}] 투입 제조 시도 중...`);
      const blockRes = await fetch("http://localhost:5003/api/manufacturer/create-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          manufacturerAddress: testManufacturer.address,
          batchId: `MFG-BLOCKED-${Date.now()}`,
          productName: "불법 원료 제조 시도품",
          quantity: 100,
          unit: "box",
          parentBatchIds: [recalledRaw.batchId],
          metadataHash: "ipfs://QmBlocked"
        })
      });

      const blockData = await blockRes.json();
      if (blockData.success) {
        throw new Error("리콜된 원료로 완제품이 제조되었습니다! 차단 로직에 결함이 있습니다.");
      }
      console.log(` ✅ 예상대로 리콜 원료 투입 제조가 차단되었습니다! (사유: ${blockData.message})`);
    }

    // 4) 제조사 자발적 자사 배치 온체인 리콜 발령 테스트
    console.log(`\n 4) 🚨 제조사 자발적 온체인 리콜 발령 시뮬레이션 [${testMfgBatchId}]...`);
    const recallRes = await fetch("http://localhost:5003/api/manufacturer/trigger-recall", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        manufacturerAddress: testManufacturer.address,
        batchId: testMfgBatchId,
        reason: "포장 포일 이물질 미세 혼입 우려로 인한 자발적 온체인 리콜"
      })
    });

    const recallData = await recallRes.json();
    if (!recallData.success) {
      throw new Error(`자발적 리콜 발령 실패: ${recallData.message}`);
    }

    console.log(" ✅ 제조사 자발적 온체인 리콜 발령 성공!");
    console.log(`    - 리콜 배치 ID  : ${recallData.recall.batchId}`);
    console.log(`    - 리콜 사유     : ${recallData.recall.reason}`);
    console.log(`    - 트랜잭션 해시 : ${recallData.recall.transactionHash}`);

    server.close(() => {
      console.log("\n==========================================================================");
      console.log(" 🎉 Step 2: 제조사 웹 무역원장 포탈 & 리콜 차단 검증 100% 성공!");
      console.log("==========================================================================\n");
      setTimeout(() => process.exit(0), 100);
    });
  });
}

main().catch((err) => {
  console.error("❌ Step 2 검증 실패:", err);
  process.exit(1);
});
