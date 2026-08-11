const hre = require("hardhat");
const { ethers } = hre;
const fs = require("fs");
const path = require("path");

/**
 * 사설 이더리움 네트워크 온체인 데이터 실시간 조회 및 계보 추적 프로그램
 * 실행 방법:
 *   1) 단독 테스트 (인메모리 자동 생성 및 조회):
 *      npx hardhat run scripts/query_onchain_data.js
 *   2) 사설 노드(npx hardhat node) 켜진 상태에서 지속 조회:
 *      npx hardhat run scripts/generate_dataset.js --network localhost
 *      npx hardhat run scripts/query_onchain_data.js --network localhost
 */
async function main() {
  console.log("==========================================================================");
  console.log(" 🔍 ChainTrace 온체인 실시간 데이터 조회 및 계보 추적 프로그램");
  console.log("==========================================================================");

  const summaryPath = path.join(__dirname, "..", "data", "supply_chain_dataset_summary.json");
  
  // 데이터셋 파일이 없거나 현재 네트워크에 컨트랙트 코드가 배치되지 않은 경우 자동 배치 구동
  let summaryData;
  if (fs.existsSync(summaryPath)) {
    summaryData = JSON.parse(fs.readFileSync(summaryPath, "utf-8"));
  }

  let registryAddr = summaryData ? summaryData.contracts.registry : null;
  let operationsAddr = summaryData ? summaryData.contracts.operations : null;

  let registryCode = registryAddr ? await ethers.provider.getCode(registryAddr) : "0x";

  // 컨트랙트가 현재 네트워크에 존재하지 않으면 자동으로 데이터셋 새로 생성
  if (!registryAddr || registryCode === "0x") {
    console.log("⚠️ 현재 네트워크에 배포된 컨트랙트가 없습니다. 온체인 데이터셋을 새로 생성합니다...\n");
    // generate_dataset 스크립트 모듈 실행
    const generateDataset = require("./generate_dataset_module");
    const result = await generateDataset();
    registryAddr = result.registryAddr;
    operationsAddr = result.operationsAddr;
    summaryData = result.summaryData;
  }

  console.log(`📍 연결된 온체인 컨트랙트 주소:`);
  console.log(` - Registry   : ${registryAddr}`);
  console.log(` - Operations : ${operationsAddr}\n`);

  const registry = await ethers.getContractAt("ChainTraceRegistry", registryAddr);
  const operations = await ethers.getContractAt("ChainTraceOperations", operationsAddr);

  // --------------------------------------------------------------------------
  // [조회 1] 전체 등록된 배치 총량 및 유형별 요약
  // --------------------------------------------------------------------------
  console.log("--------------------------------------------------------------------------");
  console.log("📌 [조회 1] 온체인 전체 배치 총량 및 유형별 요약");
  console.log("--------------------------------------------------------------------------");

  const allBatchIds = await registry.getAllBatchIds();
  console.log(`✅ 온체인에 영구 수록된 총 배치 수: ${allBatchIds.length}개`);

  const rawIds = allBatchIds.filter(id => id.startsWith("RAW"));
  const intIds = allBatchIds.filter(id => id.startsWith("INT"));
  const fgIds = allBatchIds.filter(id => id.startsWith("FG"));

  console.log(` - 1차 원료 배치 (RAW) : ${rawIds.length}개`);
  console.log(` - 중간재 배치   (INT) : ${intIds.length}개`);
  console.log(` - 최종 완제품   (FG)  : ${fgIds.length}개\n`);

  // --------------------------------------------------------------------------
  // [조회 2] 특정 단일 배치 상세 정보 온체인 실시간 조회 (예: FG-PACK03-D03)
  // --------------------------------------------------------------------------
  const sampleFgId = "FG-PACK03-D03";
  console.log("--------------------------------------------------------------------------");
  console.log(`📌 [조회 2] 특정 단일 배치 실시간 온체인 조회: [${sampleFgId}]`);
  console.log("--------------------------------------------------------------------------");

  if (await registry.batchExists(sampleFgId)) {
    const batchInfo = await registry.getBatch(sampleFgId);
    const custodian = await operations.getCurrentCustodian(sampleFgId);
    const statusNum = await operations.getBatchStatus(sampleFgId);
    const inspectResultNum = await operations.getLatestInspectionStatus(sampleFgId);
    const inspectRecords = await operations.getInspectionRecords(sampleFgId);

    const statusMap = ["NORMAL (정상)", "QUARANTINED (격리)", "RECALLED (리콜)"];
    const inspectResultMap = ["UNTESTED (미검사)", "PASSED (합격)", "FAILED (불합격)"];

    console.log(` • 배치 ID      : ${batchInfo[0]}`);
    console.log(` • 배치 유형    : ${batchInfo[1] === 0n ? "원료" : "제조 완제품"}`);
    console.log(` • 제품명       : ${batchInfo[3]}`);
    console.log(` • 수량/단위    : ${batchInfo[4]} ${batchInfo[5]}`);
    console.log(` • 최초 생성자  : ${batchInfo[2]}`);
    console.log(` • 현재 보관자  : ${custodian}`);
    console.log(` • 온체인 상태  : ${statusMap[Number(statusNum)]}`);
    console.log(` • 검사 결과    : ${inspectResultMap[Number(inspectResultNum)]}`);
    console.log(` • 상위 계보 ID : ${batchInfo[7].join(", ")}`);
    console.log(` • 메타데이터   : ${batchInfo[8]}`);

    if (inspectRecords.length > 0) {
      console.log(` • 수록 성적서  : [검사기관: ${inspectRecords[0].inspector}] IPFS: ${inspectRecords[0].certHash} (${inspectRecords[0].testDetails})`);
    }
  } else {
    console.log(` ❌ 배치가 존재하지 않습니다: ${sampleFgId}`);
  }
  console.log();

  // --------------------------------------------------------------------------
  // [조회 3] 리콜 배치(RAW-SUP02-D03) 계보 온체인 정밀 추적 (Recursive Chain Trace)
  // --------------------------------------------------------------------------
  const recalledRawId = summaryData.groundTruthRecallTrace ? summaryData.groundTruthRecallTrace.targetRecalledRawBatchId : "RAW-SUP02-D03";
  console.log("--------------------------------------------------------------------------");
  console.log(`📌 [조회 3] 온체인 계보 추적: 리콜 원료 [${recalledRawId}]의 파급 완제품 정밀 탐색`);
  console.log("--------------------------------------------------------------------------");

  // 1) 리콜 원료를 parentBatchIds로 가진 중간재 탐색
  const affectedInts = [];
  for (const intId of intIds) {
    const b = await registry.getBatch(intId);
    if (b[7].includes(recalledRawId)) {
      affectedInts.push(intId);
    }
  }

  console.log(` 1단계: 원료 [${recalledRawId}]가 직접 투입된 중간재 (${affectedInts.length}개): ${affectedInts.join(", ")}`);

  // 2) 오염 중간재를 parentBatchIds로 가진 완제품 탐색
  const affectedFgs = [];
  for (const fgId of fgIds) {
    const b = await registry.getBatch(fgId);
    const hasAffectedParent = b[7].some(pId => affectedInts.includes(pId));
    if (hasAffectedParent) {
      const custodian = await operations.getCurrentCustodian(fgId);
      const statusNum = await operations.getBatchStatus(fgId);
      const statusMap = ["NORMAL", "QUARANTINED", "RECALLED"];

      affectedFgs.push({
        batchId: fgId,
        productName: b[3],
        parentInt: b[7].find(pId => affectedInts.includes(pId)),
        custodian: custodian,
        status: statusMap[Number(statusNum)]
      });
    }
  }

  console.log(` 2단계: 오염 중간재가 사용된 최종 완제품 목록 (${affectedFgs.length}개):`);
  affectedFgs.forEach((fg, idx) => {
    console.log(`   [${idx + 1}] 배치 ID: ${fg.batchId} | 제품명: ${fg.productName}`);
    console.log(`       - 거쳐간 중간재: ${fg.parentInt}`);
    console.log(`       - 현재 보관자   : ${fg.custodian}`);
    console.log(`       - 현재 상태     : ${fg.status}`);
  });

  console.log("\n==========================================================================");
  console.log(" 🎉 온체인 데이터 실시간 조회 및 계보 추적 성공!");
  console.log("==========================================================================\n");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
