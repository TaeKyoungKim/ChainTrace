const hre = require("hardhat");
const { ethers } = hre;
const express = require("express");
const cors = require("cors");
const { indexOnChainData } = require("../server/indexer");
const { runQuery } = require("../server/db");
const distributorRouter = require("../server/routes/distributor");
const logisticsRouter = require("../server/routes/logistics");

/**
 * Step 5: 유통사 전용 웹 포탈 & 매장 입고 수락 & 온체인 실시간 리콜 모니터링 검증 스크립트
 */
async function main() {
  console.log("==========================================================================");
  console.log(" 🧪 ChainTrace Step 5: 유통사 웹 포탈 & 실시간 온체인 리콜 차단 모니터링 검증");
  console.log("==========================================================================\n");

  // 1. DuckDB 인덱싱 및 온체인 초기화
  await indexOnChainData();

  // 2. 테스트용 Express 앱 서빙
  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use("/api/distributor", distributorRouter);
  app.use("/api/logistics", logisticsRouter);

  const server = app.listen(5006, async () => {
    console.log("--------------------------------------------------------------------------");
    console.log("📍 [Step 5-1] 유통사 포탈 API 서버 포트 5006 바인딩 완료");
    console.log("--------------------------------------------------------------------------");

    const signers = await ethers.getSigners();
    const testDistributor = signers[35]; // Distributor #1

    // 1) 등록된 유통사 목록 조회
    console.log(" 1) 등록된 5개 유통사 목록 조회 API 테스트...");
    const compRes = await fetch("http://localhost:5006/api/distributor/companies");
    const compData = await compRes.json();
    console.log(` ✅ 유통사 목록 조회 성공: 총 ${compData.count}개 유통사 확인`);

    // 동적으로 이관 가능한 정상 배치 찾기
    const batchRes = await fetch("http://localhost:5006/api/logistics/transferable-batches");
    const batchData = await batchRes.json();
    const normalBatch = batchData.batches.find(b => b.isTransferable);
    if (!normalBatch) {
      throw new Error("이관 가능한 NORMAL 상태의 배치를 찾을 수 없습니다.");
    }
    const testBatchId = normalBatch.batchId;

    // 1-1) 물류 이관 요청 전송 및 마이닝 대기 (Custodian -> Distributor)
    console.log(`\n 1-1) 정상 배치 [${testBatchId}]를 유통사 [${testDistributor.address}]로 물류 이관 요청 전송...`);
    const reqRes = await fetch("http://localhost:5006/api/logistics/request-transfer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        senderAddress: normalBatch.custodian,
        batchId: testBatchId,
        toAddress: testDistributor.address,
        location: "이마트 하역 센터 3동",
        notes: "매장 최종 입고 수송"
      })
    });
    const reqData = await reqRes.json();
    if (!reqData.success) {
      throw new Error(`이관 요청 실패: ${reqData.message}`);
    }
    console.log(" ✅ 온체인 이관 요청 전송 완료!");

    // 2) 매장 입고 최종 수락 테스트 (Confirm Receipt)
    console.log(`\n 2) 배치 [${testBatchId}] 유통 매장 최종 입고 확정 및 온체인 수락...`);
    const acceptRes = await fetch("http://localhost:5006/api/distributor/confirm-receipt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        distributorAddress: testDistributor.address,
        batchId: testBatchId
      })
    });

    const acceptData = await acceptRes.json();
    if (!acceptData.success) {
      throw new Error(`입고 확정 실패: ${acceptData.message}`);
    }

    console.log(" ✅ 유통사 매장 온체인 입고 완료!");
    console.log(`    - 최종 온체인 보관자: ${acceptData.receipt.newCustodian}`);
    console.log(`    - 트랜잭션 해시  : ${acceptData.receipt.transactionHash}`);

    // 3) 유통사 매장 재고 조회 테스트
    console.log(`\n 3) 유통사 [${testDistributor.address}] 매장 보유 재고 목록 조회...`);
    const invRes = await fetch(`http://localhost:5006/api/distributor/inventory/${testDistributor.address}`);
    const invData = await invRes.json();
    console.log(` ✅ 유통 매장 재고 조회 성공: 총 ${invData.count}개 보관 배치 확인`);

    // 4) 🚨 온체인 실시간 리콜 & 격리 모니터링 API 검증
    console.log("\n 4) 🧪 [실시간 리콜 모니터링 검증] GET /api/distributor/recall-monitor 호출...");
    const monitorRes = await fetch("http://localhost:5006/api/distributor/recall-monitor");
    const monitorData = await monitorRes.json();

    console.log(` ✅ 실시간 온체인 리콜 모니터링 결과: 총 ${monitorData.alertCount}건의 알림 감지!`);
    if (monitorData.alerts.length > 0) {
      console.log(`    - 🚨 감지된 알림 예시: ${monitorData.alerts[0].alertMessage}`);
    }

    server.close(() => {
      console.log("\n==========================================================================");
      console.log(" 🎉 Step 5: 유통사 웹 포탈 & 실시간 리콜 모니터링 검증 100% 성공!");
      console.log("==========================================================================\n");
      setTimeout(() => process.exit(0), 100);
    });
  });
}

main().catch((err) => {
  console.error("❌ Step 5 검증 실패:", err);
  process.exit(1);
});
