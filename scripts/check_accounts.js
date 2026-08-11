const hre = require("hardhat");
const { ethers } = hre;

async function main() {
  const signers = await ethers.getSigners();
  console.log(`================================================================`);
  console.log(` 📍 사설 네트워크 계정 생성 확인 (총 ${signers.length}개 계정)`);
  console.log(`================================================================\n`);

  for (let i = 0; i < signers.length; i++) {
    const balance = await ethers.provider.getBalance(signers[i].address);
    const ethBalance = ethers.formatEther(balance);
    console.log(`[Account #${i + 1}] ${signers[i].address} => ${ethBalance} ETH`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
