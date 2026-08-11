const hre = require("hardhat");
const { ethers } = hre;
const fs = require("fs");
const path = require("path");

/**
 * 100% 결정론적(Deterministic) 14일치 공급망 데이터 대량 생성 스크립트
 * 시드 기반 PRNG를 사용하여 매 실행 시 동일한 이력 데이터셋이 생성됩니다.
 */

// 시드 기반 PRNG (Mulberry32)
function createPRNG(seed) {
  let s = seed;
  return function () {
    let t = (s += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rng = createPRNG(20260811); // 고정 시드

function getRandomInt(min, max) {
  return Math.floor(rng() * (max - min + 1)) + min;
}

function getRandomItem(array) {
  return array[Math.floor(rng() * array.length)];
}

async function main() {
  console.log("==========================================================================");
  console.log(" 🏭 ChainTrace 14일간 공급망 대량 이력 데이터 시뮬레이션 및 데이터셋 생성");
  console.log("==========================================================================");

  const signers = await ethers.getSigners();
  if (signers.length < 41) {
    throw new Error(`최소 41개 이상의 계정이 필요합니다. 현재: ${signers.length}`);
  }

  const admin = signers[0];

  // 1. 40개 참여자 분배 (원료사 10, 제조사 8, 물류사 12, 검사기관 5, 유통사 5)
  const suppliers = signers.slice(1, 11).map((s, i) => ({
    signer: s,
    address: s.address,
    name: [
      "금산유기농원료", "풍기인삼농업", "지리산약초조합", "강원산삼농장", "제주허브원료",
      "충주농산원료", "나주배농업가공", "보성녹차원재료", "영주인삼원료사", "안동약용작물"
    ][i]
  }));

  const manufacturers = signers.slice(11, 19).map((s, i) => ({
    signer: s,
    address: s.address,
    name: [
      "한국홍삼제조(주)", "한독바이오제약", "CJ웰케어제조센터", "종근당건강제작소",
      "일양약품제조공장", "대웅제약식품사업부", "유한양행헬스케어", "동국제약가공센터"
    ][i]
  }));

  const logistics = signers.slice(19, 31).map((s, i) => ({
    signer: s,
    address: s.address,
    name: [
      "CJ대한통운", "한진택배", "롯데글로벌로지스", "우체국물류센터", "로젠택배",
      "쿠팡로지스틱스", "경동화물", "대신정기화물", "일양로지스", "동부익스프레스",
      "LX판토스", "보성통운"
    ][i]
  }));

  const inspectors = signers.slice(31, 36).map((s, i) => ({
    signer: s,
    address: s.address,
    name: [
      "국가식품품질검사원", "한국의약품시험연구원", "SGS코리아검사원",
      "KTR한국화학융합시험원", "KCL한국건설생활환경시험원"
    ][i]
  }));

  const distributors = signers.slice(36, 41).map((s, i) => ({
    signer: s,
    address: s.address,
    name: [
      "이마트전국유통센터", "롯데마트동부Hub", "홈플러스물류센터",
      "GS리테일통합Hub", "CU_BGF리테일"
    ][i]
  }));

  console.log(`\n👥 40개 참여 기업 준비 완료:`);
  console.log(` - 원료 공급사 : ${suppliers.length}개`);
  console.log(` - 제조사       : ${manufacturers.length}개`);
  console.log(` - 물류사       : ${logistics.length}개`);
  console.log(` - 검사기관     : ${inspectors.length}개`);
  console.log(` - 유통사       : ${distributors.length}개\n`);

  // 2. 스마트 컨트랙트 배포
  console.log("--------------------------------------------------------------------------");
  console.log("📍 Step 1: 스마트 컨트랙트 배포 및 40개 참여자 온체인 권한 등록");
  console.log("--------------------------------------------------------------------------");

  const RegistryFactory = await ethers.getContractFactory("ChainTraceRegistry");
  const registry = await RegistryFactory.deploy();
  await registry.waitForDeployment();
  const registryAddr = await registry.getAddress();

  const OperationsFactory = await ethers.getContractFactory("ChainTraceOperations");
  const operations = await OperationsFactory.deploy(registryAddr);
  await operations.waitForDeployment();
  const operationsAddr = await operations.getAddress();

  console.log(`✅ Registry Contract  : ${registryAddr}`);
  console.log(`✅ Operations Contract: ${operationsAddr}`);

  // 역할 Hash
  const SUPPLIER_ROLE = await registry.SUPPLIER_ROLE();
  const MANUFACTURER_ROLE = await registry.MANUFACTURER_ROLE();
  const INSPECTOR_ROLE = await registry.INSPECTOR_ROLE();
  const LOGISTICS_ROLE = await registry.LOGISTICS_ROLE();
  const DISTRIBUTOR_ROLE = await registry.DISTRIBUTOR_ROLE();

  // 40개 참여자 온체인 등록
  for (const s of suppliers) {
    await (await registry.connect(admin).registerParticipant(s.address, SUPPLIER_ROLE, s.name)).wait();
  }
  for (const m of manufacturers) {
    await (await registry.connect(admin).registerParticipant(m.address, MANUFACTURER_ROLE, m.name)).wait();
  }
  for (const l of logistics) {
    await (await registry.connect(admin).registerParticipant(l.address, LOGISTICS_ROLE, l.name)).wait();
  }
  for (const i of inspectors) {
    await (await registry.connect(admin).registerParticipant(i.address, INSPECTOR_ROLE, i.name)).wait();
  }
  for (const d of distributors) {
    await (await registry.connect(admin).registerParticipant(d.address, DISTRIBUTOR_ROLE, d.name)).wait();
  }
  console.log(`✅ 40개 기업 온체인 권한(Role) 등록 완료!`);

  // 추적용 데이터 구조
  const allRawBatches = [];
  const allIntBatches = [];
  const allFgBatches = [];
  const dailyLogs = [];
  const eventDetails = [];

  // 특정 이벤트 대상 선정을 위한 고정 변수
  let targetRecalledRawId = "RAW-SUP02-D03"; // Day 3에 생성할 특정 리콜 대상 원료 배치
  let suspendedLogistics = logistics[4];      // "로젠택배" (Day 9 자격 정지)

  // 3. 14일간 시뮬레이션 루프
  console.log("\n--------------------------------------------------------------------------");
  console.log("📍 Step 2: 14일간 일별 공급망 트랜잭션 시뮬레이션 구동");
  console.log("--------------------------------------------------------------------------");

  for (let day = 1; day <= 14; day++) {
    console.log(`▶ [Day ${day}/14] 공급망 활동 진행 중...`);

    const dayLog = { day, rawCount: 0, intCount: 0, fgCount: 0, inspections: 0, transfers: 0 };

    // --- (1) 원료 생산 (Suppliers) ---
    const rawItems = ["6년근 수삼", "청정 약초", "유기농 허브", "영주 산삼", "지리산 당귀", "제주 백출"];
    for (let sIdx = 0; sIdx < suppliers.length; sIdx++) {
      const supp = suppliers[sIdx];
      const batchId = `RAW-SUP${String(sIdx + 1).padStart(2, '0')}-D${String(day).padStart(2, '0')}`;
      const item = getRandomItem(rawItems);
      const qty = getRandomInt(100, 500);

      await (await registry.connect(supp.signer).createRawMaterialBatch(
        batchId,
        `${item} (${supp.name})`,
        qty,
        "kg",
        `ipfs://QmRawMeta_${batchId}`
      )).wait();

      allRawBatches.push({ batchId, supplier: supp, productName: `${item} (${supp.name})`, day, passedInspection: false });
      dayLog.rawCount++;

      // 원료 검사
      const inspector = getRandomItem(inspectors);
      // Day 5 사건: 검사 불합격률 급증 (75% 불합격)
      let isPassed = true;
      let note = "원료 기준 적합";
      if (day === 5) {
        isPassed = rng() > 0.75; // 75% 확률로 불합격
        note = isPassed ? "특별 총력 검사 적합" : "잔류농약 허용기준 초과 (Day 5 집중검사 걸림)";
      } else {
        isPassed = rng() > 0.15; // 평소 85% 합격
        note = isPassed ? "원료 기준 적합" : "수분 함량 기준 미달";
      }

      await (await operations.connect(inspector.signer).recordInspection(
        batchId,
        isPassed,
        `ipfs://QmCert_${batchId}`,
        note
      )).wait();

      dayLog.inspections++;
      if (isPassed) {
        allRawBatches.find(b => b.batchId === batchId).passedInspection = true;
      }
    }

    // --- (2) 중간재 제조 (Manufacturers, Parent: RAW) ---
    const passedRaw = allRawBatches.filter(b => b.passedInspection);
    if (passedRaw.length > 0) {
      for (let mIdx = 0; mIdx < manufacturers.length; mIdx++) {
        const mfg = manufacturers[mIdx];
        const batchId = `INT-MFG${String(mIdx + 1).padStart(2, '0')}-D${String(day).padStart(2, '0')}`;

        // 원료 1~2개 조합
        const parentRaw1 = getRandomItem(passedRaw);
        const parentRaw2 = getRandomItem(passedRaw);
        const parentIds = Array.from(new Set([parentRaw1.batchId, parentRaw2.batchId]));

        await (await registry.connect(mfg.signer).createManufacturedBatch(
          batchId,
          `농축 농축액 중간재 (Day ${day})`,
          getRandomInt(50, 200),
          "L",
          parentIds,
          `ipfs://QmIntMeta_${batchId}`
        )).wait();

        allIntBatches.push({ batchId, manufacturer: mfg, parentBatchIds: parentIds, day, passedInspection: false });
        dayLog.intCount++;

        // 중간재 검사
        const inspector = getRandomItem(inspectors);
        let isPassed = rng() > 0.1; // 90% 합격
        let certDetails = "중간재 파라미터 적합";

        // Day 7 사건: 검사 유효기간 정책 변경 수록
        if (day === 7 && mIdx === 0) {
          certDetails = "POLICY_CHANGE: 품질 검사 유효기간 30일 -> 90일 연장 표준 적용";
          eventDetails.push({ day: 7, event: "검사 유효기간 설정 변경 (30일 -> 90일 연장)" });
        }

        await (await operations.connect(inspector.signer).recordInspection(
          batchId,
          isPassed,
          `ipfs://QmCert_${batchId}`,
          certDetails
        )).wait();

        dayLog.inspections++;
        if (isPassed) {
          allIntBatches.find(b => b.batchId === batchId).passedInspection = true;
        }
      }
    }

    // --- (3) 완제품 제조 (Manufacturers, Parent: INT) ---
    const passedInt = allIntBatches.filter(b => b.passedInspection);
    if (passedInt.length > 0) {
      for (let mIdx = 0; mIdx < 4; mIdx++) {
        const mfg = manufacturers[mIdx];
        const batchId = `FG-PACK${String(mIdx + 1).padStart(2, '0')}-D${String(day).padStart(2, '0')}`;

        const parentInt = getRandomItem(passedInt);

        await (await registry.connect(mfg.signer).createManufacturedBatch(
          batchId,
          `프리미엄 건강 홍삼정 파우치 (Day ${day})`,
          getRandomInt(100, 300),
          "box",
          [parentInt.batchId],
          `ipfs://QmFgMeta_${batchId}`
        )).wait();

        allFgBatches.push({ batchId, manufacturer: mfg, parentBatchIds: [parentInt.batchId], day, passedInspection: false });
        dayLog.fgCount++;

        // 완제품 검사
        const inspector = getRandomItem(inspectors);
        const isPassed = true; // 완제품은 전량 통과 시뮬레이션

        await (await operations.connect(inspector.signer).recordInspection(
          batchId,
          isPassed,
          `ipfs://QmCert_${batchId}`,
          "완제품 출하 적합 승인"
        )).wait();

        dayLog.inspections++;
        allFgBatches.find(b => b.batchId === batchId).passedInspection = true;

        // --- (4) 출하 및 물류 이관 (Custody Transfer) ---
        // Day 9 사건: 특정 물류사(로젠택배) 자격 정지
        let selectedLogistics = getRandomItem(logistics);
        if (day >= 9 && selectedLogistics.address === suspendedLogistics.address) {
          selectedLogistics = logistics[0]; // 다른 물류사로 우회
        }

        // 제조사 -> 물류사 이관 요청 및 승인
        await (await operations.connect(mfg.signer).requestTransfer(
          batchId,
          selectedLogistics.address,
          "대전 Hub 물류센터",
          "안전 운송 요청"
        )).wait();

        await (await operations.connect(selectedLogistics.signer).acceptTransfer(batchId)).wait();
        dayLog.transfers++;

        // 물류사 -> 유통사 이관 (Day 9 이전 또는 자격 정지된 물류사가 아닌 경우만)
        const distributor = getRandomItem(distributors);
        await (await operations.connect(selectedLogistics.signer).requestTransfer(
          batchId,
          distributor.address,
          "전국 유통 센터",
          "입고 완료 요청"
        )).wait();

        // 10% 확률로 유통사 거부/미승인 테스트 (인수 승인을 하지 않음)
        const acceptByDistributor = rng() > 0.1;
        if (acceptByDistributor) {
          await (await operations.connect(distributor.signer).acceptTransfer(batchId)).wait();
          dayLog.transfers++;
        }
      }
    }

    // --- (5) 특정 일자 사건 발생 트리거 ---

    // Day 5 사건 기록
    if (day === 5) {
      eventDetails.push({ day: 5, event: "원료 집중 검사 실시로 인한 검사 반려률 급증 (75% 반려)" });
    }

    // Day 9 사건: 물류사 자격 정지 (Revoke)
    if (day === 9) {
      await (await registry.connect(admin).revokeParticipant(suspendedLogistics.address, LOGISTICS_ROLE)).wait();
      eventDetails.push({
        day: 9,
        event: `물류사 자격 정지 발령: [${suspendedLogistics.name}] (${suspendedLogistics.address}) 권한 박탈`
      });
    }

    // Day 11 사건: 특정 원료 배치 리콜 발령
    if (day === 11) {
      const targetRawExists = allRawBatches.some(b => b.batchId === targetRecalledRawId);
      if (targetRawExists) {
        await (await operations.connect(admin).triggerRecall(
          targetRecalledRawId,
          "중금속(카드뮴) 기준치 초과로 인한 긴급 온체인 리콜 발령"
        )).wait();

        eventDetails.push({
          day: 11,
          event: `특정 원료 배치 리콜 발령: [${targetRecalledRawId}] (사유: 중금속 카드뮴 기준치 초과)`
        });
      }
    }

    dailyLogs.push(dayLog);
  }

  console.log(`✅ 14일간의 공급망 이력 생성 완료! (생성된 총 배치: 원료 ${allRawBatches.length}개, 중간재 ${allIntBatches.length}개, 완제품 ${allFgBatches.length}개)`);

  // 4. 정답지(Ground Truth) 추적 계산: 리콜된 원료가 유입된 최종 완제품 계보 정밀 계산
  console.log("\n--------------------------------------------------------------------------");
  console.log("📍 Step 3: 리콜 원료 배치 계보 정밀 추적 (정답 데이터 세트 계산)");
  console.log("--------------------------------------------------------------------------");

  console.log(`🔍 리콜 대상 원료 배치 ID: [${targetRecalledRawId}]`);

  // 1단계: 영향받은 중간재(INT) 검색
  const affectedIntBatches = allIntBatches.filter(intB => intB.parentBatchIds.includes(targetRecalledRawId));
  const affectedIntIds = affectedIntBatches.map(b => b.batchId);

  // 2단계: 영향받은 최종 완제품(FG) 검색
  const affectedFgBatches = allFgBatches.filter(fgB => fgB.parentBatchIds.some(pId => affectedIntIds.includes(pId)));
  const affectedFgIds = affectedFgBatches.map(b => b.batchId);

  // 실시간 온체인 상태 및 보관자 조회
  const affectedFgDetails = [];
  for (const fg of affectedFgBatches) {
    const custodian = await operations.getCurrentCustodian(fg.batchId);
    const statusNum = await operations.getBatchStatus(fg.batchId);
    let statusStr = "NORMAL";
    if (statusNum === 1n) statusStr = "QUARANTINED";
    if (statusNum === 2n) statusStr = "RECALLED";

    // 보관자 이름 매핑
    let custodianName = custodian;
    const allEntities = [...suppliers, ...manufacturers, ...logistics, ...inspectors, ...distributors];
    const entity = allEntities.find(e => e.address.toLowerCase() === custodian.toLowerCase());
    if (entity) custodianName = `${entity.name} (${custodian.slice(0, 6)}...)`;

    affectedFgDetails.push({
      batchId: fg.batchId,
      productName: (await registry.getBatch(fg.batchId)).productName,
      manufacturer: fg.manufacturer.name,
      parentIntBatch: fg.parentBatchIds[0],
      currentCustodian: custodianName,
      status: statusStr
    });
  }

  console.log(`🎯 추적 결과:`);
  console.log(` - 리콜 원료 [${targetRecalledRawId}]가 직접 투입된 중간재 : ${affectedIntIds.length}개 (${affectedIntIds.join(", ")})`);
  console.log(` - 리콜 원료 오염이 파급된 최종 완제품           : ${affectedFgIds.length}개 (${affectedFgIds.join(", ")})`);

  // 5. 요약 결과 파일 생성 (JSON 및 Markdown)
  const dataDir = path.join(__dirname, "..", "data");
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const jsonSummaryPath = path.join(dataDir, "supply_chain_dataset_summary.json");
  const mdSummaryPath = path.join(dataDir, "supply_chain_dataset_summary.md");

  const summaryData = {
    generatedAt: new Date().toISOString(),
    randomSeed: 20260811,
    totalDays: 14,
    contracts: {
      registry: registryAddr,
      operations: operationsAddr
    },
    participantCounts: {
      suppliers: suppliers.length,
      manufacturers: manufacturers.length,
      logistics: logistics.length,
      inspectors: inspectors.length,
      distributors: distributors.length,
      total: 40
    },
    totalBatchesCreated: {
      raw: allRawBatches.length,
      intermediate: allIntBatches.length,
      finishedGoods: allFgBatches.length,
      grandTotal: allRawBatches.length + allIntBatches.length + allFgBatches.length
    },
    insertedEvents: eventDetails,
    groundTruthRecallTrace: {
      targetRecalledRawBatchId: targetRecalledRawId,
      affectedIntermediateBatches: affectedIntIds,
      affectedFinishedGoodsCount: affectedFgIds.length,
      affectedFinishedGoodsList: affectedFgDetails
    }
  };

  fs.writeFileSync(jsonSummaryPath, JSON.stringify(summaryData, null, 2), "utf-8");

  // Markdown 보고서 생성
  const mdContent = `# ChainTrace 14일간 공급망 대량 데이터셋 요약 보고서 (AI 검증용 정답지)

- **생성 일시**: ${summaryData.generatedAt}
- **난수 고정 시드 (PRNG Seed)**: \`20260811\`
- **스마트 컨트랙트 주소**:
  - Registry: \`${registryAddr}\`
  - Operations: \`${operationsAddr}\`

---

## 1. 40개 참여 기업 구성
- 원료사(10개), 제조사(8개), 물류사(12개), 검사기관(5개), 유통사(5개)

## 2. 생성된 배치 총계
- **원료 배치 (RAW)**: ${allRawBatches.length}개
- **중간재 배치 (INT)**: ${allIntBatches.length}개
- **완제품 배치 (FG)**: ${allFgBatches.length}개
- **총 생성 배치 수**: ${summaryData.totalBatchesCreated.grandTotal}개

---

## 3. 14일간 주입된 4대 핵심 사건 (Anomalies)

| 날짜 | 이벤트 구분 | 상세 내용 |
| :--- | :--- | :--- |
| **Day 5** | 검사 반려 급증 | 원료 집중 검사 실시로 인한 검사 반려율 급증 (75% 반려) |
| **Day 7** | 규정 변경 | 품질 검사 유효기간 기준 변경 (30일 ➔ 90일 연장 표준 적용) |
| **Day 9** | 물류사 자격 정지 | [${suspendedLogistics.name}] (${suspendedLogistics.address}) 권한 박탈 및 이관 우회 |
| **Day 11** | 원료 리콜 발령 | [${targetRecalledRawId}] 배치 중금속(카드뮴) 기준치 초과로 인한 온체인 리콜 |

---

## 4. 🔥 Ground Truth: 리콜 원료 [${targetRecalledRawId}] 정밀 계보 추적 결과 (정답지)

- **리콜 원료 ID**: \`${targetRecalledRawId}\`
- **오염 유입된 중간재 (${affectedIntIds.length}개)**: \`${affectedIntIds.join("`, `")}\`
- **파급 영향을 받은 최종 완제품 총 수량**: **${affectedFgIds.length}개**

### 최종 영향 완제품 상세 목록

| 완제품 배치 ID | 제품명 | 제조사 | 거쳐간 중간재 | 현재 보관자 | 상태 |
| :--- | :--- | :--- | :--- | :--- | :--- |
${affectedFgDetails.map(fg => `| \`${fg.batchId}\` | ${fg.productName} | ${fg.manufacturer} | \`${fg.parentIntBatch}\` | ${fg.currentCustodian} | **${fg.status}** |`).join("\n")}

---
*본 요약 파일은 향후 LangGraph AI Agent의 질의응답 및 규정대조, 계보 추적 정확도 검증용 정답 데이터로 사용됩니다.*
`;

  fs.writeFileSync(mdSummaryPath, mdContent, "utf-8");

  console.log("\n==========================================================================");
  console.log(" 🎉 14일간 대량 공급망 데이터셋 생성 및 요약 보고서 파일 저장 완료!");
  console.log(` 📄 JSON 데이터 파일 : ${jsonSummaryPath}`);
  console.log(` 📄 Markdown 보고서 : ${mdSummaryPath}`);
  console.log("==========================================================================\n");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
