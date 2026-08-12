const hre = require("hardhat");
const { ethers } = hre;
const fs = require("fs");
const path = require("path");

/**
 * ChainTrace 스마트 컨트랙트 2종 순수 배포 전용 스크립트
 * 실행 방법: node scripts/deploy.js --network localhost
 */
async function main() {
  console.log("================================================================");
  console.log(" 🚀 ChainTrace 스마트 컨트랙트 2종 사설 네트워크 배포 시작");
  console.log("================================================================\n");

  const [admin] = await ethers.getSigners();
  console.log(`📍 배포자(Admin) 계정 주소: ${admin.address}\n`);

  // 1. ChainTraceRegistry 배포
  console.log("1. ChainTraceRegistry 스마트 컨트랙트 배포 중...");
  const RegistryFactory = await ethers.getContractFactory("ChainTraceRegistry");
  const registry = await RegistryFactory.deploy();
  await registry.waitForDeployment();
  const registryAddr = await registry.getAddress();
  console.log(`✅ ChainTraceRegistry 배포 완료: ${registryAddr}\n`);

  // 2. ChainTraceOperations 배포
  console.log("2. ChainTraceOperations 스마트 컨트랙트 배포 중...");
  const OperationsFactory = await ethers.getContractFactory("ChainTraceOperations");
  const operations = await OperationsFactory.deploy(registryAddr);
  await operations.waitForDeployment();
  const operationsAddr = await operations.getAddress();
  console.log(`✅ ChainTraceOperations 배포 완료: ${operationsAddr}\n`);

  // 3. 배포 정보 data/supply_chain_dataset_summary.json 업데이트
  const dataDir = path.join(__dirname, "..", "data");
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const summaryPath = path.join(dataDir, "supply_chain_dataset_summary.json");
  let summary = {};
  if (fs.existsSync(summaryPath)) {
    summary = JSON.parse(fs.readFileSync(summaryPath, "utf-8"));
  }

  summary.contracts = {
    registry: registryAddr,
    operations: operationsAddr
  };
  summary.deployedAt = new Date().toISOString();

  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2), "utf-8");

  console.log("================================================================");
  console.log(" 🎉 스마트 컨트랙트 2종 배포 및 설정 저장 완료!");
  console.log(` 📄 Registry 주소  : ${registryAddr}`);
  console.log(` 📄 Operations 주소: ${operationsAddr}`);
  console.log("================================================================\n");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
