const hre = require("hardhat");
const { ethers } = hre;
const fs = require("fs");
const path = require("path");

function createPRNG(seed) {
  let s = seed;
  return function () {
    let t = (s += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function runDatasetGeneration() {
  const rng = createPRNG(20260811);
  function getRandomInt(min, max) { return Math.floor(rng() * (max - min + 1)) + min; }
  function getRandomItem(array) { return array[Math.floor(rng() * array.length)]; }

  const signers = await ethers.getSigners();
  const admin = signers[0];

  const suppliers = signers.slice(1, 11).map((s, i) => ({
    signer: s, address: s.address,
    name: ["금산유기농원료", "풍기인삼농업", "지리산약초조합", "강원산삼농장", "제주허브원료", "충주농산원료", "나주배농업가공", "보성녹차원재료", "영주인삼원료사", "안동약용작물"][i]
  }));

  const manufacturers = signers.slice(11, 19).map((s, i) => ({
    signer: s, address: s.address,
    name: ["한국홍삼제조(주)", "한독바이오제약", "CJ웰케어제조센터", "종근당건강제작소", "일양약품제조공장", "대웅제약식품사업부", "유한양행헬스케어", "동국제약가공센터"][i]
  }));

  const logistics = signers.slice(19, 31).map((s, i) => ({
    signer: s, address: s.address,
    name: ["CJ대한통운", "한진택배", "롯데글로벌로지스", "우체국물류센터", "로젠택배", "쿠팡로지스틱스", "경동화물", "대신정기화물", "일양로지스", "동부익스프레스", "LX판토스", "보성통운"][i]
  }));

  const inspectors = signers.slice(31, 36).map((s, i) => ({
    signer: s, address: s.address,
    name: ["국가식품품질검사원", "한국의약품시험연구원", "SGS코리아검사원", "KTR한국화학융합시험원", "KCL한국건설생활환경시험원"][i]
  }));

  const distributors = signers.slice(36, 41).map((s, i) => ({
    signer: s, address: s.address,
    name: ["이마트전국유통센터", "롯데마트동부Hub", "홈플러스물류센터", "GS리테일통합Hub", "CU_BGF리테일"][i]
  }));

  const RegistryFactory = await ethers.getContractFactory("ChainTraceRegistry");
  const registry = await RegistryFactory.deploy();
  await registry.waitForDeployment();
  const registryAddr = await registry.getAddress();

  const OperationsFactory = await ethers.getContractFactory("ChainTraceOperations");
  const operations = await OperationsFactory.deploy(registryAddr);
  await operations.waitForDeployment();
  const operationsAddr = await operations.getAddress();

  const SUPPLIER_ROLE = await registry.SUPPLIER_ROLE();
  const MANUFACTURER_ROLE = await registry.MANUFACTURER_ROLE();
  const INSPECTOR_ROLE = await registry.INSPECTOR_ROLE();
  const LOGISTICS_ROLE = await registry.LOGISTICS_ROLE();
  const DISTRIBUTOR_ROLE = await registry.DISTRIBUTOR_ROLE();

  for (const s of suppliers) await (await registry.connect(admin).registerParticipant(s.address, SUPPLIER_ROLE, s.name)).wait();
  for (const m of manufacturers) await (await registry.connect(admin).registerParticipant(m.address, MANUFACTURER_ROLE, m.name)).wait();
  for (const l of logistics) await (await registry.connect(admin).registerParticipant(l.address, LOGISTICS_ROLE, l.name)).wait();
  for (const i of inspectors) await (await registry.connect(admin).registerParticipant(i.address, INSPECTOR_ROLE, i.name)).wait();
  for (const d of distributors) await (await registry.connect(admin).registerParticipant(d.address, DISTRIBUTOR_ROLE, d.name)).wait();

  const allRawBatches = [];
  const allIntBatches = [];
  const allFgBatches = [];
  const targetRecalledRawId = "RAW-SUP02-D03";
  const suspendedLogistics = logistics[4];

  for (let day = 1; day <= 14; day++) {
    const rawItems = ["6년근 수삼", "청정 약초", "유기농 허브", "영주 산삼", "지리산 당귀", "제주 백출"];
    for (let sIdx = 0; sIdx < suppliers.length; sIdx++) {
      const supp = suppliers[sIdx];
      const batchId = `RAW-SUP${String(sIdx + 1).padStart(2, '0')}-D${String(day).padStart(2, '0')}`;
      const item = getRandomItem(rawItems);
      const qty = getRandomInt(100, 500);

      await (await registry.connect(supp.signer).createRawMaterialBatch(batchId, `${item} (${supp.name})`, qty, "kg", `ipfs://QmRawMeta_${batchId}`)).wait();
      allRawBatches.push({ batchId, supplier: supp, productName: `${item} (${supp.name})`, day, passedInspection: false });

      const inspector = getRandomItem(inspectors);
      let isPassed = day === 5 ? (rng() > 0.75) : (rng() > 0.15);
      let note = day === 5 ? (isPassed ? "특별 검사 적합" : "잔류농약 기준 초과 (Day 5)") : (isPassed ? "원료 적합" : "수분 함량 미달");

      await (await operations.connect(inspector.signer).recordInspection(batchId, isPassed, `ipfs://QmCert_${batchId}`, note)).wait();
      if (isPassed) allRawBatches.find(b => b.batchId === batchId).passedInspection = true;
    }

    const passedRaw = allRawBatches.filter(b => b.passedInspection);
    if (passedRaw.length > 0) {
      for (let mIdx = 0; mIdx < manufacturers.length; mIdx++) {
        const mfg = manufacturers[mIdx];
        const batchId = `INT-MFG${String(mIdx + 1).padStart(2, '0')}-D${String(day).padStart(2, '0')}`;
        const parentRaw1 = getRandomItem(passedRaw);
        const parentRaw2 = getRandomItem(passedRaw);
        const parentIds = Array.from(new Set([parentRaw1.batchId, parentRaw2.batchId]));

        await (await registry.connect(mfg.signer).createManufacturedBatch(batchId, `농축액 중간재 (Day ${day})`, getRandomInt(50, 200), "L", parentIds, `ipfs://QmIntMeta_${batchId}`)).wait();
        allIntBatches.push({ batchId, manufacturer: mfg, parentBatchIds: parentIds, day, passedInspection: false });

        const inspector = getRandomItem(inspectors);
        let isPassed = rng() > 0.1;
        let certDetails = (day === 7 && mIdx === 0) ? "POLICY_CHANGE: 유효기간 30일 -> 90일 연장" : "중간재 검사 적합";

        await (await operations.connect(inspector.signer).recordInspection(batchId, isPassed, `ipfs://QmCert_${batchId}`, certDetails)).wait();
        if (isPassed) allIntBatches.find(b => b.batchId === batchId).passedInspection = true;
      }
    }

    const passedInt = allIntBatches.filter(b => b.passedInspection);
    if (passedInt.length > 0) {
      for (let mIdx = 0; mIdx < 4; mIdx++) {
        const mfg = manufacturers[mIdx];
        const batchId = `FG-PACK${String(mIdx + 1).padStart(2, '0')}-D${String(day).padStart(2, '0')}`;
        const parentInt = getRandomItem(passedInt);

        await (await registry.connect(mfg.signer).createManufacturedBatch(batchId, `프리미엄 건강 홍삼정 파우치 (Day ${day})`, getRandomInt(100, 300), "box", [parentInt.batchId], `ipfs://QmFgMeta_${batchId}`)).wait();
        allFgBatches.push({ batchId, manufacturer: mfg, parentBatchIds: [parentInt.batchId], day, passedInspection: true });

        const inspector = getRandomItem(inspectors);
        await (await operations.connect(inspector.signer).recordInspection(batchId, true, `ipfs://QmCert_${batchId}`, "완제품 출하 승인")).wait();

        let selectedLogistics = getRandomItem(logistics);
        if (day >= 9 && selectedLogistics.address === suspendedLogistics.address) selectedLogistics = logistics[0];

        await (await operations.connect(mfg.signer).requestTransfer(batchId, selectedLogistics.address, "대전 Hub", "안전 운송")).wait();
        await (await operations.connect(selectedLogistics.signer).acceptTransfer(batchId)).wait();

        const distributor = getRandomItem(distributors);
        await (await operations.connect(selectedLogistics.signer).requestTransfer(batchId, distributor.address, "전국 센터", "입고 요청")).wait();
        if (rng() > 0.1) await (await operations.connect(distributor.signer).acceptTransfer(batchId)).wait();
      }
    }

    if (day === 9) await (await registry.connect(admin).revokeParticipant(suspendedLogistics.address, LOGISTICS_ROLE)).wait();
    if (day === 11 && allRawBatches.some(b => b.batchId === targetRecalledRawId)) {
      await (await operations.connect(admin).triggerRecall(targetRecalledRawId, "중금속 카드뮴 초과 리콜")).wait();
    }
  }

  const affectedIntBatches = allIntBatches.filter(intB => intB.parentBatchIds.includes(targetRecalledRawId));
  const affectedIntIds = affectedIntBatches.map(b => b.batchId);
  const affectedFgBatches = allFgBatches.filter(fgB => fgB.parentBatchIds.some(pId => affectedIntIds.includes(pId)));
  const affectedFgIds = affectedFgBatches.map(b => b.batchId);

  const affectedFgDetails = [];
  for (const fg of affectedFgBatches) {
    const custodian = await operations.getCurrentCustodian(fg.batchId);
    const statusNum = await operations.getBatchStatus(fg.batchId);
    let statusStr = "NORMAL";
    if (statusNum === 1n) statusStr = "QUARANTINED";
    if (statusNum === 2n) statusStr = "RECALLED";

    affectedFgDetails.push({
      batchId: fg.batchId,
      productName: (await registry.getBatch(fg.batchId)).productName,
      manufacturer: fg.manufacturer.name,
      parentIntBatch: fg.parentBatchIds[0],
      currentCustodian: custodian,
      status: statusStr
    });
  }

  const summaryData = {
    generatedAt: new Date().toISOString(),
    contracts: { registry: registryAddr, operations: operationsAddr },
    groundTruthRecallTrace: {
      targetRecalledRawBatchId: targetRecalledRawId,
      affectedIntermediateBatches: affectedIntIds,
      affectedFinishedGoodsCount: affectedFgIds.length,
      affectedFinishedGoodsList: affectedFgDetails
    }
  };

  const dataDir = path.join(__dirname, "..", "data");
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, "supply_chain_dataset_summary.json"), JSON.stringify(summaryData, null, 2), "utf-8");

  return { registryAddr, operationsAddr, summaryData };
}

module.exports = runDatasetGeneration;
