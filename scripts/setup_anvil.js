const hre = require("hardhat");
const { ethers } = hre;
const fs = require("fs");
const path = require("path");
const { indexOnChainData } = require("../server/indexer");

/**
 * ⚡ Anvil / Hardhat Node 치트코드 RPC API 기반 1회성 Setup 스크립트
 */
async function main() {
  console.log("==========================================================================");
  console.log(" ⚡ ChainTrace: 치트코드 RPC 기반 1회성 Setup 스크립트 시작");
  console.log("==========================================================================\n");

  const rpcUrl = "http://127.0.0.1:8545";
  const provider = new ethers.JsonRpcProvider(rpcUrl);

  // 사설 노드 구동 및 블록 번호 확인
  try {
    const blockNum = await provider.getBlockNumber();
    console.log(`📡 사설 노드 연결 성공 (URL: ${rpcUrl} | 최신 블록: #${blockNum})`);
  } catch (err) {
    console.error("❌ 사설 노드(Port 8545)에 연결할 수 없습니다.");
    console.error("💡 [해결 방법] 먼저 다른 터미널 창에서 노드를 먼저 구동해주세요:");
    console.error("   - Hardhat 노드 구동 : npm run node");
    console.error("   - Anvil 노드 구동   : npm run anvil  (Foundry 설치 시)");
    process.exit(1);
  }

  const signers = await ethers.getSigners();
  console.log(`🔑 사설 계정 ${signers.length}개 로딩 완료 (기본 관리자: ${signers[0].address})`);

  // 1. [Cheatcode API] setBalance: 40개 지갑 계정에 즉시 100,000 ETH 충전
  console.log("\n--------------------------------------------------------------------------");
  console.log("📍 [Phase 2-1] 치트코드 RPC 'setBalance' 계정 잔액 일괄 충전");
  console.log("--------------------------------------------------------------------------");

  const balanceHex = "0x152D02C7E14AF6800000"; // 100,000 ETH in Wei
  for (let i = 0; i < Math.min(signers.length, 40); i++) {
    const addr = signers[i].address;
    try {
      await provider.send("anvil_setBalance", [addr, balanceHex]);
    } catch (e) {
      try {
        await provider.send("hardhat_setBalance", [addr, balanceHex]);
      } catch (err) {
        // fallback
      }
    }
  }
  console.log(` ✅ 40개 주요 기업 계정 잔액 100,000 ETH 충전 완료!`);

  // 2. 스마트 컨트랙트 배포
  console.log("\n--------------------------------------------------------------------------");
  console.log("📍 [Phase 2-2] 스마트 컨트랙트 2종 (Registry, Operations) 온체인 배포");
  console.log("--------------------------------------------------------------------------");

  const adminSigner = signers[0];
  const RegistryFactory = await ethers.getContractFactory("ChainTraceRegistry", adminSigner);
  const registry = await RegistryFactory.deploy();
  await registry.waitForDeployment();
  const registryAddr = await registry.getAddress();
  console.log(` ✅ ChainTraceRegistry 배포 완료: ${registryAddr}`);

  const OperationsFactory = await ethers.getContractFactory("ChainTraceOperations", adminSigner);
  const operations = await OperationsFactory.deploy(registryAddr);
  await operations.waitForDeployment();
  const operationsAddr = await operations.getAddress();
  console.log(` ✅ ChainTraceOperations 배포 완료: ${operationsAddr}`);

  // 3. [Cheatcode API] impersonateAccount: 40개 기업 지갑 권한 부여 (grantRole)
  console.log("\n--------------------------------------------------------------------------");
  console.log("📍 [Phase 2-3] 치트코드 RPC 'impersonateAccount' 기업 권한 일괄 수록");
  console.log("--------------------------------------------------------------------------");

  try {
    await provider.send("anvil_impersonateAccount", [adminSigner.address]);
  } catch (e) {
    try {
      await provider.send("hardhat_impersonateAccount", [adminSigner.address]);
    } catch (err) {}
  }

  const supplierRole = await registry.SUPPLIER_ROLE();
  const mfgRole = await registry.MANUFACTURER_ROLE();
  const inspectorRole = await registry.INSPECTOR_ROLE();
  const logisticsRole = await registry.LOGISTICS_ROLE();
  const distRole = await registry.DISTRIBUTOR_ROLE();

  // 원료사 (0~9), 제조사 (10~19), 검사기관 (20~24), 물류사 (25~34), 유통사 (35~39)
  for (let i = 0; i < 10; i++) await (await registry.connect(adminSigner).grantRole(supplierRole, signers[i].address)).wait();
  for (let i = 10; i < 20; i++) await (await registry.connect(adminSigner).grantRole(mfgRole, signers[i].address)).wait();
  for (let i = 20; i < 25; i++) await (await registry.connect(adminSigner).grantRole(inspectorRole, signers[i].address)).wait();
  for (let i = 25; i < 35; i++) await (await registry.connect(adminSigner).grantRole(logisticsRole, signers[i].address)).wait();
  for (let i = 35; i < 40; i++) await (await registry.connect(adminSigner).grantRole(distRole, signers[i].address)).wait();

  try {
    await provider.send("anvil_stopImpersonatingAccount", [adminSigner.address]);
  } catch (e) {
    try {
      await provider.send("hardhat_stopImpersonatingAccount", [adminSigner.address]);
    } catch (err) {}
  }

  console.log(` ✅ 40개 기업 5대 역할 권한 (AccessControl Roles) 온체인 수록 완료!`);

  // 4. 배포 주소 및 ABI 요약 파일 동기화
  console.log("\n--------------------------------------------------------------------------");
  console.log("📍 [Phase 2-4] 데이터셋 요약 JSON 메타데이터 및 DuckDB 색인 동기화");
  console.log("--------------------------------------------------------------------------");

  const summaryPath = path.join(__dirname, "..", "data", "supply_chain_dataset_summary.json");
  let summary = {};
  if (fs.existsSync(summaryPath)) {
    summary = JSON.parse(fs.readFileSync(summaryPath, "utf-8"));
  }

  summary.contracts = {
    registry: registryAddr,
    operations: operationsAddr,
    deployedAt: new Date().toISOString(),
    network: "localhost_8545"
  };

  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2), "utf-8");
  console.log(` ✅ summary JSON 배포 주소 업데이트 완료! (${summaryPath})`);

  // DuckDB 색인
  await indexOnChainData();

  console.log("\n==========================================================================");
  console.log(" 🎉 치트코드 RPC 기반 1회성 Setup 완료!");
  console.log(`    - Registry   : ${registryAddr}`);
  console.log(`    - Operations : ${operationsAddr}`);
  console.log("==========================================================================\n");
}

main().catch((err) => {
  console.error("❌ Setup 실패:", err);
  process.exit(1);
});
