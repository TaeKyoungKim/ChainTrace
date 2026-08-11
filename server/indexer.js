const hre = require("hardhat");
const { ethers } = hre;
const { initSchema, execSql, runQuery } = require("./db");
const fs = require("fs");
const path = require("path");

/**
 * DuckDB 온체인 이력 데이터 고속 인덱싱 모듈
 */
async function indexOnChainData() {
  await initSchema();

  console.log("--------------------------------------------------------------------------");
  console.log("📌 [DuckDB Indexer] 온체인 이벤트 및 데이터셋 고속 색인 시작");
  console.log("--------------------------------------------------------------------------");

  const summaryPath = path.join(__dirname, "..", "data", "supply_chain_dataset_summary.json");
  let summary;

  if (fs.existsSync(summaryPath)) {
    summary = JSON.parse(fs.readFileSync(summaryPath, "utf-8"));
  }

  let registryAddr = summary ? summary.contracts.registry : null;
  let operationsAddr = summary ? summary.contracts.operations : null;

  let code = registryAddr ? await ethers.provider.getCode(registryAddr) : "0x";

  // 컨트랙트가 현재 네트워크에 존재하지 않으면 자동으로 데이터셋 새로 생성
  if (!registryAddr || code === "0x") {
    console.log("⚠️ 현재 네트워크에 배포된 컨트랙트가 없습니다. 온체인 데이터셋을 새로 생성합니다...");
    const generateDatasetModule = require("../scripts/generate_dataset_module");
    const result = await generateDatasetModule();
    registryAddr = result.registryAddr;
    operationsAddr = result.operationsAddr;
  }

  // 테이블 기존 데이터 초기화
  await execSql(`
    DELETE FROM genealogy;
    DELETE FROM inspections;
    DELETE FROM transfers;
    DELETE FROM recalls;
    DELETE FROM batches;
    DELETE FROM participants;
  `);

  const registry = await ethers.getContractAt("ChainTraceRegistry", registryAddr);
  const operations = await ethers.getContractAt("ChainTraceOperations", operationsAddr);

  // 1. 참여자(Participants) 인덱싱
  console.log(" 1) 참여 기업 40개 온체인 정보 DuckDB 인덱싱...");
  const signers = await ethers.getSigners();
  const roles = [
    await registry.SUPPLIER_ROLE(),
    await registry.MANUFACTURER_ROLE(),
    await registry.INSPECTOR_ROLE(),
    await registry.LOGISTICS_ROLE(),
    await registry.DISTRIBUTOR_ROLE()
  ];
  const roleNames = ["SUPPLIER", "MANUFACTURER", "INSPECTOR", "LOGISTICS", "DISTRIBUTOR"];

  for (let i = 0; i < signers.length; i++) {
    const addr = signers[i].address;
    const info = await registry.getParticipant(addr);
    if (info[2]) { // info[2] = isRegistered
      let roleStr = "UNKNOWN";
      for (let rIdx = 0; rIdx < roles.length; rIdx++) {
        if (info[1] === roles[rIdx]) { // info[1] = role
          roleStr = roleNames[rIdx];
          break;
        }
      }
      const regTime = new Date(Number(info[3]) * 1000).toISOString(); // info[3] = registeredAt
      await runQuery(
        `INSERT INTO participants VALUES (?, ?, ?, ?, ?)`,
        [String(addr), String(roleStr), String(info[0]), Boolean(info[2]), String(regTime)]
      );
    }
  }

  // 2. 배치(Batches) & 계보(Genealogy) 인덱싱
  console.log(" 2) 전체 배치(308개) 및 상위-하위 계보 트리 DuckDB 인덱싱...");
  const allBatchIds = await registry.getAllBatchIds();

  for (const bId of allBatchIds) {
    const b = await registry.getBatch(bId);
    // b[0]: batchId, b[1]: batchType, b[2]: creator, b[3]: productName, b[4]: quantity, b[5]: unit, b[6]: createdAt, b[7]: parentBatchIds, b[8]: metadataHash
    const batchIdStr = String(b[0]);
    const bTypeStr = b[1] === 0n ? "RAW_MATERIAL" : "MANUFACTURED";
    const creatorAddr = String(b[2]);
    const productNameStr = String(b[3]);
    const qtyNum = Number(b[4]);
    const unitStr = String(b[5]);
    const createdTime = new Date(Number(b[6]) * 1000).toISOString();
    const metaHashStr = String(b[8]);

    await runQuery(
      `INSERT INTO batches VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [batchIdStr, bTypeStr, creatorAddr, productNameStr, qtyNum, unitStr, createdTime, metaHashStr]
    );

    // 계보(Genealogy) 관계 테이블 수록 (Parent -> Child)
    const parents = b[7];
    for (const pId of parents) {
      await runQuery(`INSERT INTO genealogy VALUES (?, ?)`, [String(pId), batchIdStr]);
    }

    // 검사 성적서 인덱싱
    const inspectRecords = await operations.getInspectionRecords(bId);
    for (const r of inspectRecords) {
      // r[0]: inspector, r[1]: isPassed, r[2]: certHash, r[3]: testDetails, r[4]: timestamp
      const inspectTime = new Date(Number(r[4]) * 1000).toISOString();
      await runQuery(
        `INSERT INTO inspections VALUES (?, ?, ?, ?, ?, ?)`,
        [batchIdStr, String(r[0]), Boolean(r[1]), String(r[2]), String(r[3]), inspectTime]
      );
    }

    // 리콜 상태 인덱싱
    const statusNum = await operations.getBatchStatus(bId);
    if (statusNum === 2n) { // RECALLED
      const custodian = await operations.getCurrentCustodian(bId);
      const recallTime = new Date().toISOString();
      await runQuery(
        `INSERT INTO recalls VALUES (?, ?, ?, ?)`,
        [batchIdStr, String(custodian), "온체인 리콜 발령 수록", recallTime]
      );
    }
  }

  const batchCount = await runQuery(`SELECT count(*) as count FROM batches`);
  const genCount = await runQuery(`SELECT count(*) as count FROM genealogy`);
  const inspectCount = await runQuery(`SELECT count(*) as count FROM inspections`);
  const recallCount = await runQuery(`SELECT count(*) as count FROM recalls`);

  console.log(`✅ DuckDB 인덱싱 완료!`);
  console.log(`   - 배치 (Batches)       : ${batchCount[0].count}건`);
  console.log(`   - 계보 관계 (Genealogy): ${genCount[0].count}건`);
  console.log(`   - 검사 성적서 (Inspect): ${inspectCount[0].count}건`);
  console.log(`   - 리콜 발령 (Recalls)  : ${recallCount[0].count}건\n`);
}

module.exports = {
  indexOnChainData
};
