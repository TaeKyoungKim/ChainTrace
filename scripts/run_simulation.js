const hre = require("hardhat");
const { ethers } = hre;

/**
 * ChainTrace 2종 스마트 컨트랙트 종합 시뮬레이션 및 검증 스크립트
 * (실행 방법: npx hardhat run scripts/run_simulation.js)
 */
async function main() {
  console.log("================================================================");
  console.log(" 🚀 ChainTrace 스마트 컨트랙트 엔드투엔드 시뮬레이션 시작");
  console.log("================================================================\n");

  const [admin, supplier, manufacturer, inspector, logistics, distributor] = await ethers.getSigners();

  console.log("📍 [계정 주소 확인]");
  console.log(` - Admin        : ${admin.address}`);
  console.log(` - Supplier     : ${supplier.address}`);
  console.log(` - Manufacturer : ${manufacturer.address}`);
  console.log(` - Inspector    : ${inspector.address}`);
  console.log(` - Logistics    : ${logistics.address}`);
  console.log(` - Distributor  : ${distributor.address}\n`);

  // 1. 컨트랙트 배포
  console.log("----------------------------------------------------------------");
  console.log("Step 1: 스마트 컨트랙트 배포");
  console.log("----------------------------------------------------------------");
  const RegistryFactory = await ethers.getContractFactory("ChainTraceRegistry");
  const registry = await RegistryFactory.deploy();
  await registry.waitForDeployment();
  const registryAddr = await registry.getAddress();
  console.log(`✅ ChainTraceRegistry 배포 완료: ${registryAddr}`);

  const OperationsFactory = await ethers.getContractFactory("ChainTraceOperations");
  const operations = await OperationsFactory.deploy(registryAddr);
  await operations.waitForDeployment();
  const operationsAddr = await operations.getAddress();
  console.log(`✅ ChainTraceOperations 배포 완료: ${operationsAddr}\n`);

  // 2. 참여자 역할 등록
  console.log("----------------------------------------------------------------");
  console.log("Step 2: 5대 참여자 역할(Role) 등록");
  console.log("----------------------------------------------------------------");
  const SUPPLIER_ROLE = await registry.SUPPLIER_ROLE();
  const MANUFACTURER_ROLE = await registry.MANUFACTURER_ROLE();
  const INSPECTOR_ROLE = await registry.INSPECTOR_ROLE();
  const LOGISTICS_ROLE = await registry.LOGISTICS_ROLE();
  const DISTRIBUTOR_ROLE = await registry.DISTRIBUTOR_ROLE();

  await (await registry.connect(admin).registerParticipant(supplier.address, SUPPLIER_ROLE, "금산유기농원료(주)")).wait();
  await (await registry.connect(admin).registerParticipant(manufacturer.address, MANUFACTURER_ROLE, "(주)한국홍삼제조")).wait();
  await (await registry.connect(admin).registerParticipant(inspector.address, INSPECTOR_ROLE, "국가식품품질검사원")).wait();
  await (await registry.connect(admin).registerParticipant(logistics.address, LOGISTICS_ROLE, "CJ대한통운물류")).wait();
  await (await registry.connect(admin).registerParticipant(distributor.address, DISTRIBUTOR_ROLE, "이마트유통센터")).wait();

  console.log("✅ 5개 참여 기업 역할 및 정보 등록 완료!\n");

  // 3. 원료 및 완제품 배치 생성 (계보 연결)
  console.log("----------------------------------------------------------------");
  console.log("Step 3: 원료 배치 및 제조 완제품 배치 생성 (계보 연결)");
  console.log("----------------------------------------------------------------");
  const rawBatchId = "RAW-GINSENG-2026";
  const mfgBatchId = "MFG-EXTRACT-2026";

  // 원료 배치 생성
  await (await registry.connect(supplier).createRawMaterialBatch(
    rawBatchId,
    "6년근 청정 수삼",
    1000,
    "kg",
    "ipfs://QmRawGinsengCertHash"
  )).wait();
  console.log(`✅ 원료 공급사 배치 생성 완료: [${rawBatchId}] (제품명: 6년근 청정 수삼, 수량: 1000kg)`);

  // 완제품 배치 생성 (원료 배치 계보 연결)
  await (await registry.connect(manufacturer).createManufacturedBatch(
    mfgBatchId,
    "6년근 프리미엄 홍삼정 스틱 30포",
    500,
    "box",
    [rawBatchId],
    "ipfs://QmManufacturedSpec"
  )).wait();
  console.log(`✅ 제조사 완제품 배치 생성 완료: [${mfgBatchId}]`);
  
  const mfgBatch = await registry.getBatch(mfgBatchId);
  console.log(`   - 연결된 원료 계보(Parent Batch): ${mfgBatch.parentBatchIds.join(", ")}\n`);

  // 4. 품질 검사 성적서 수록
  console.log("----------------------------------------------------------------");
  console.log("Step 4: 검사기관 품질 검사 성적서 서명 수록");
  console.log("----------------------------------------------------------------");
  await (await operations.connect(inspector).recordInspection(
    mfgBatchId,
    true, // 통과
    "ipfs://QmQualityInspectCert123",
    "잔류농약 0%, 성분 함량 검사 합격"
  )).wait();

  const inspectStatus = await operations.getLatestInspectionStatus(mfgBatchId);
  const statusStr = inspectStatus === 1n ? "PASSED (합격)" : "FAILED (불합격)";
  console.log(`✅ 품질 검사 결과 온체인 수록 완료: [${mfgBatchId}] ➔ ${statusStr}\n`);

  // 5. 물류 이관 (Manufacturer -> Logistics -> Distributor)
  console.log("----------------------------------------------------------------");
  console.log("Step 5: 소유권 및 인수/인도 이관 (Custody Transfer)");
  console.log("----------------------------------------------------------------");
  // 5-1. 제조사 -> 물류사
  await (await operations.connect(manufacturer).requestTransfer(
    mfgBatchId,
    logistics.address,
    "대전 물류허브센터",
    "콜드체인 4도 유지"
  )).wait();
  console.log(` 1) 제조사 ➔ 물류사 이관 요청 완료`);

  await (await operations.connect(logistics).acceptTransfer(mfgBatchId)).wait();
  let custodian = await operations.getCurrentCustodian(mfgBatchId);
  console.log(` 2) 물류사 이관 수락 완료. 현재 보관자: ${custodian}`);

  // 5-2. 물류사 -> 유통사
  await (await operations.connect(logistics).requestTransfer(
    mfgBatchId,
    distributor.address,
    "서울 중앙유통센터",
    "정상 인도 완료"
  )).wait();

  await (await operations.connect(distributor).acceptTransfer(mfgBatchId)).wait();
  custodian = await operations.getCurrentCustodian(mfgBatchId);
  console.log(` 3) 유통사 이관 수락 완료. 현재 보관자: ${custodian}\n`);

  // 6. 리콜 발령 및 차단 시율레이션
  console.log("----------------------------------------------------------------");
  console.log("Step 6: 결함 발생 및 리콜(Recall) 동적 차단 검증");
  console.log("----------------------------------------------------------------");
  await (await operations.connect(inspector).triggerRecall(mfgBatchId, "용기 세척 공정 결함 가능성으로 인한 리콜")).wait();
  
  const statusNum = await operations.getBatchStatus(mfgBatchId);
  const statusText = statusNum === 2n ? "RECALLED (리콜 중)" : "NORMAL";
  console.log(`🚨 배치 상태 전환 완료: [${mfgBatchId}] ➔ ${statusText}`);

  try {
    console.log(" 🧪 [차단 검증] 리콜 조치된 배치의 이관 시도 중...");
    await operations.connect(distributor).requestTransfer(
      mfgBatchId,
      supplier.address,
      "반품창고",
      "반품 시도"
    );
  } catch (err) {
    console.log(` ✅ 예상대로 이관 시도가 차단되었습니다! (사유: ${err.message})`);
  }

  console.log("\n================================================================");
  console.log(" 🎉 스마트 컨트랙트 2종 엔드투엔드 시뮬레이션 성공!");
  console.log("================================================================\n");
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

