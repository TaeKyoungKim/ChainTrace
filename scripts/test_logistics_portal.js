const hre = require("hardhat");
const { ethers } = hre;
const express = require("express");
const cors = require("cors");
const { indexOnChainData } = require("../server/indexer");
const { runQuery } = require("../server/db");
const logisticsRouter = require("../server/routes/logistics");
const inspectorRouter = require("../server/routes/inspector");

/**
 * Step 4: 물류사 전용 웹 포탈 & 소유권 이관 요청/수락 & 격리 배치 이관 차단 검증 스크립트
 */
async function main() {
  console.log("==========================================================================");
  console.log(" 🧪 ChainTrace Step 4: 물류사 웹 포탈 & 콜드체인 이관/차단 통합 검증");
  console.log("==========================================================================\n");

  // 1. DuckDB 인덱싱 및 온체인 초기화
  await indexOnChainData();

  // 2. 테스트용 Express 앱 서빙
  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use("/api/logistics", logisticsRouter);
  app.use("/api/inspector", inspectorRouter);

  const server = app.listen(5005, async () => {
    console.log("--------------------------------------------------------------------------");
    console.log("📍 [Step 4-1] 물류사 포탈 API 서버 포트 5005 바인딩 완료");
    console.log("--------------------------------------------------------------------------");

    const signers = await ethers.getSigners();
    const logisticsSigner = signers[18]; // Logistics #1
    const inspectorSigner = signers[30]; // Inspector #1
    const quarantineBatchId = "RAW-SUP03-D03";

    // 1) 물류사 목록 및 배치 조회
    console.log(" 1) 등록된 물류사 및 이관 가능 배치 목록 조회...");
    const compRes = await fetch("http://localhost:5005/api/logistics/companies");
    const compData = await compRes.json();
    console.log(` ✅ 물류사 목록 조회 성공: 총 ${compData.count}개 물류사 등록 확인`);

    const batchRes = await fetch("http://localhost:5005/api/logistics/transferable-batches");
    const batchData = await batchRes.json();
    const normalBatch = batchData.batches.find(b => b.isTransferable);

    if (!normalBatch) {
      throw new Error("이관 가능한 NORMAL 상태의 배치를 찾을 수 없습니다.");
    }

    const senderAddress = normalBatch.custodian;
    const normalBatchId = normalBatch.batchId;

    // 2) 정상 배치 소유권 이관 요청 (Sender ➔ Logistics)
    console.log(`\n 2) 정상 배치 [${normalBatchId}] 이관 요청 (발송자: ${senderAddress} ➔ 인수자: ${logisticsSigner.address})...`);
    const reqRes = await fetch("http://localhost:5005/api/logistics/request-transfer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        senderAddress: senderAddress,
        batchId: normalBatchId,
        toAddress: logisticsSigner.address,
        location: "인천물류센터 센터A-102",
        notes: "콜드체인 적정 온습도(4℃) 규격 운송 중"
      })
    });

    const reqData = await reqRes.json();
    if (!reqData.success) {
      throw new Error(`이관 요청 실패: ${reqData.message}`);
    }
    console.log(" ✅ 온체인 이관 요청 트랜잭션 성공!");
    console.log(`    - 트랜잭션 해시: ${reqData.transfer.transactionHash}`);

    // 3) 물류사 소유권 이관 인도 수락 (Accept Transfer)
    console.log(`\n 3) 물류사 [${logisticsSigner.address}] 온체인 인도 인수 수락 서명...`);
    const acceptRes = await fetch("http://localhost:5005/api/logistics/accept-transfer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        receiverAddress: logisticsSigner.address,
        batchId: normalBatchId
      })
    });

    const acceptData = await acceptRes.json();
    if (!acceptData.success) {
      throw new Error(`이관 수락 실패: ${acceptData.message}`);
    }
    console.log(" ✅ 온체인 이관 인도 수락 완료!");
    console.log(`    - 새 온체인 보관자: ${acceptData.receipt.newCustodian}`);
    console.log(`    - 트랜잭션 해시  : ${acceptData.receipt.transactionHash}`);

    if (acceptData.receipt.newCustodian.toLowerCase() !== logisticsSigner.address.toLowerCase()) {
      throw new Error("보관자(Custodian) 주소가 물류사 주소로 변경되지 않았습니다.");
    }

    // 4) 🚨 결함 시나리오 검증: QUARANTINED(격리) 배치의 물류 이관 시도 ➔ 차단 검증
    console.log(`\n 4) 🧪 [결함 시나리오 차단 검증] 먼저 배치 [${quarantineBatchId}]를 검사 불합격(QUARANTINED) 조치 중...`);
    await fetch("http://localhost:5005/api/inspector/record-inspection", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        inspectorAddress: inspectorSigner.address,
        batchId: quarantineBatchId,
        isPassed: false,
        certHash: "ipfs://QmFailQuarantineTest",
        testDetails: "중금속 기준 초과 검출 (격리 조치)"
      })
    });

    console.log(`   🚨 격리된 배치 [${quarantineBatchId}] 물류 이관 요청 시도 중...`);
    const blockedRes = await fetch("http://localhost:5005/api/logistics/request-transfer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        senderAddress: senderAddress,
        batchId: quarantineBatchId,
        toAddress: logisticsSigner.address,
        location: "불법 이관 시도",
        notes: "이관 테스트"
      })
    });

    const blockedData = await blockedRes.json();
    if (blockedData.success) {
      throw new Error("격리(QUARANTINED) 상태 배치의 이관이 성공했습니다! 이관 차단 로직에 결함이 있습니다.");
    }

    console.log(` ✅ 예상대로 격리 배치의 이관이 온체인/API에서 거부되었습니다!`);
    console.log(`    - 거부 사유: ${blockedData.message}`);

    server.close(() => {
      console.log("\n==========================================================================");
      console.log(" 🎉 Step 4: 물류사 웹 포탈 & 콜드체인 이관/차단 검증 100% 성공!");
      console.log("==========================================================================\n");
      setTimeout(() => process.exit(0), 100);
    });
  });
}

main().catch((err) => {
  console.error("❌ Step 4 검증 실패:", err);
  process.exit(1);
});
