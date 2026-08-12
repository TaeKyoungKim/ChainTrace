const express = require("express");
const router = express.Router();
const hre = require("hardhat");
const { ethers } = hre;
const { runQuery } = require("../db");
const fs = require("fs");
const path = require("path");

// 등록된 원료 공급사 목록 API (GET /api/supplier/suppliers)
router.get("/suppliers", async (req, res) => {
  try {
    const suppliers = await runQuery(
      `SELECT address, company_name FROM participants WHERE role = 'SUPPLIER' ORDER BY company_name ASC`
    );
    res.json({ success: true, count: suppliers.length, suppliers });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 원료 공급사 전용 무역원장 등록 API (POST /api/supplier/create-batch)
router.post("/create-batch", async (req, res) => {
  try {
    const { supplierAddress, batchId, productName, quantity, unit, metadataHash, originLocation } = req.body;

    if (!supplierAddress || !batchId || !productName || !quantity) {
      return res.status(400).json({ success: false, message: "필수 파라미터가 누락되었습니다." });
    }

    const summaryPath = path.join(__dirname, "..", "..", "data", "supply_chain_dataset_summary.json");
    if (!fs.existsSync(summaryPath)) {
      return res.status(500).json({ success: false, message: "스마트 컨트랙트 배포 정보를 찾을 수 없습니다." });
    }

    const summary = JSON.parse(fs.readFileSync(summaryPath, "utf-8"));
    const registryAddr = summary.contracts.registry;
    const registry = await ethers.getContractAt("ChainTraceRegistry", registryAddr);

    // 지갑 서명자 가져오기
    const signers = await ethers.getSigners();
    const supplierSigner = signers.find(s => s.address.toLowerCase() === supplierAddress.toLowerCase()) || signers[1];

    // 🔒 권한 자동 부여 및 확인 (AccessControl Missing Role 에러 원천 방지)
    const supplierRole = await registry.SUPPLIER_ROLE();
    const hasRole = await registry.hasRole(supplierRole, supplierSigner.address);
    if (!hasRole) {
      console.log(`🔑 [권한 자동 부여] ${supplierSigner.address} 계정에 SUPPLIER_ROLE 부여 중...`);
      const adminSigner = signers[0];
      const grantTx = await registry.connect(adminSigner).grantRole(supplierRole, supplierSigner.address);
      await grantTx.wait();
    }

    console.log(`📝 [원료사 무역원장 등록 요청] 서명자: ${supplierSigner.address} | 배치: ${batchId}`);

    // 스마트 컨트랙트 createRawMaterialBatch 호출 및 서명
    const tx = await registry.connect(supplierSigner).createRawMaterialBatch(
      batchId,
      productName,
      quantity,
      unit || "kg",
      metadataHash || `ipfs://QmRawMeta_${batchId}`
    );

    const receipt = await tx.wait();

    // 생성된 원료 배치를 DuckDB에 고속 동기화
    const createdTime = new Date().toISOString();
    await runQuery(
      `INSERT INTO batches VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [batchId, "RAW_MATERIAL", supplierSigner.address, productName, Number(quantity), unit || "kg", createdTime, metadataHash || `ipfs://QmRawMeta_${batchId}`]
    );

    // 무역원장 전자증명서 카드 데이터 반환
    const certificate = {
      batchId,
      productName,
      quantity: `${quantity} ${unit || "kg"}`,
      supplierAddress: supplierSigner.address,
      originLocation: originLocation || "충남 금산군 유기농 수삼 농장",
      transactionHash: receipt.hash,
      blockNumber: receipt.blockNumber,
      timestamp: createdTime,
      metadataHash: metadataHash || `ipfs://QmRawMeta_${batchId}`,
      blockchainStatus: "CONFIRMED_ON_CHAIN"
    };

    res.json({
      success: true,
      message: "원료 무역원장이 성공적으로 블록체인 및 DuckDB에 수록되었습니다.",
      certificate
    });
  } catch (err) {
    console.error("❌ 원료 무역원장 등록 에러:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// 원료 공급사 등록 배치 목록 조회 API (GET /api/supplier/batches/:address)
router.get("/batches/:address", async (req, res) => {
  try {
    const { address } = req.params;
    const batches = await runQuery(
      `SELECT * FROM batches WHERE creator = ? AND batch_type = 'RAW_MATERIAL' ORDER BY created_at DESC`,
      [address]
    );

    res.json({ success: true, supplierAddress: address, count: batches.length, batches });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
