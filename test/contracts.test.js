const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("ChainTrace Smart Contracts Integration Test (Pure JavaScript)", function () {
  let registry;
  let operations;

  let admin;
  let supplier;
  let manufacturer;
  let inspector;
  let logistics;
  let distributor;

  let SUPPLIER_ROLE;
  let MANUFACTURER_ROLE;
  let INSPECTOR_ROLE;
  let LOGISTICS_ROLE;
  let DISTRIBUTOR_ROLE;

  before(async function () {
    [admin, supplier, manufacturer, inspector, logistics, distributor] = await ethers.getSigners();

    // 1. ChainTraceRegistry 배포
    const RegistryFactory = await ethers.getContractFactory("ChainTraceRegistry");
    registry = await RegistryFactory.deploy();
    await registry.waitForDeployment();

    // 2. ChainTraceOperations 배포
    const OperationsFactory = await ethers.getContractFactory("ChainTraceOperations");
    operations = await OperationsFactory.deploy(await registry.getAddress());
    await operations.waitForDeployment();

    // 역할 Hash 가져오기
    SUPPLIER_ROLE = await registry.SUPPLIER_ROLE();
    MANUFACTURER_ROLE = await registry.MANUFACTURER_ROLE();
    INSPECTOR_ROLE = await registry.INSPECTOR_ROLE();
    LOGISTICS_ROLE = await registry.LOGISTICS_ROLE();
    DISTRIBUTOR_ROLE = await registry.DISTRIBUTOR_ROLE();
  });

  describe("1. 참여자(Stakeholder) 권한 및 역할 등록", function () {
    it("Admin이 5대 참여자를 올바르게 등록해야 함", async function () {
      await registry.connect(admin).registerParticipant(supplier.address, SUPPLIER_ROLE, "금산유기농원료(주)");
      await registry.connect(admin).registerParticipant(manufacturer.address, MANUFACTURER_ROLE, "(주)한국홍삼제조");
      await registry.connect(admin).registerParticipant(inspector.address, INSPECTOR_ROLE, "국가식품품질검사원");
      await registry.connect(admin).registerParticipant(logistics.address, LOGISTICS_ROLE, "CJ대한통운물류");
      await registry.connect(admin).registerParticipant(distributor.address, DISTRIBUTOR_ROLE, "이마트유통센터");

      const suppInfo = await registry.getParticipant(supplier.address);
      expect(suppInfo.companyName).to.equal("금산유기농원료(주)");
      expect(suppInfo.isRegistered).to.be.true;

      const mfgInfo = await registry.getParticipant(manufacturer.address);
      expect(mfgInfo.companyName).to.equal("(주)한국홍삼제조");
      expect(mfgInfo.isRegistered).to.be.true;
    });

    it("등록되지 않은 계정은 원료 배치를 생성할 수 없어야 함", async function () {
      await expect(
        registry.connect(distributor).createRawMaterialBatch(
          "RAW-UNAUTH-001",
          "무단원료",
          100,
          "kg",
          "ipfs://QmInvalid"
        )
      ).to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount");
    });
  });

  describe("2. 원료 및 제조 제품 배치(Batch) 생성과 계보(Genealogy) 연결", function () {
    const rawBatchId = "RAW-GINSENG-20260811";
    const mfgBatchId = "MFG-EXTRACT-20260811";

    it("원료 공급사(Supplier)가 원료 배치(RAW)를 생성할 수 있어야 함", async function () {
      await registry.connect(supplier).createRawMaterialBatch(
        rawBatchId,
        "6년근 500g 유기농 수삼",
        1000,
        "kg",
        "ipfs://QmRawGinsengCertHash123"
      );

      const batch = await registry.getBatch(rawBatchId);
      expect(batch.productName).to.equal("6년근 500g 유기농 수삼");
      expect(batch.creator).to.equal(supplier.address);
      expect(batch.parentBatchIds.length).to.equal(0);
    });

    it("제조사(Manufacturer)가 원료 배치를 상위 배치(Parent)로 지정하여 완제품(MFG)을 생성해야 함", async function () {
      await registry.connect(manufacturer).createManufacturedBatch(
        mfgBatchId,
        "프리미엄 6년근 홍삼정 스틱 30포",
        500,
        "box",
        [rawBatchId],
        "ipfs://QmManufacturedSpec456"
      );

      const batch = await registry.getBatch(mfgBatchId);
      expect(batch.productName).to.equal("프리미엄 6년근 홍삼정 스틱 30포");
      expect(batch.creator).to.equal(manufacturer.address);
      expect(batch.parentBatchIds[0]).to.equal(rawBatchId);
    });
  });

  describe("3. 품질 검사 성적서 등록 및 결과 검증", function () {
    const mfgBatchId = "MFG-EXTRACT-20260811";

    it("검사기관(Inspector)이 품질 검사 성적서 통과(PASSED)를 등록해야 함", async function () {
      await operations.connect(inspector).recordInspection(
        mfgBatchId,
        true,
        "ipfs://QmInspectionCertPass789",
        "잔류농약 0%, 성분 함량 규격 적합"
      );

      const inspectStatus = await operations.getLatestInspectionStatus(mfgBatchId);
      expect(inspectStatus).to.equal(1); // 1 = PASSED

      const records = await operations.getInspectionRecords(mfgBatchId);
      expect(records.length).to.equal(1);
      expect(records[0].isPassed).to.be.true;
      expect(records[0].inspector).to.equal(inspector.address);
    });
  });

  describe("4. 소유권 및 인수/인도 이관 (Custody Transfer)", function () {
    const mfgBatchId = "MFG-EXTRACT-20260811";

    it("현재 보관자(제조사)가 물류사로 이관을 요청하고 물류사가 수락해야 함", async function () {
      // 1. 이관 요청 (Manufacturer -> Logistics)
      await operations.connect(manufacturer).requestTransfer(
        mfgBatchId,
        logistics.address,
        "대전 중앙물류허브센터",
        "콜드체인 4도 유지 운송"
      );

      // 2. 수락 전 보관자 확인 (여전히 Manufacturer)
      let currentCust = await operations.getCurrentCustodian(mfgBatchId);
      expect(currentCust).to.equal(manufacturer.address);

      // 3. 물류사가 이관 수락
      await operations.connect(logistics).acceptTransfer(mfgBatchId);

      // 4. 수락 후 보관자 확인 (Logistics로 변경)
      currentCust = await operations.getCurrentCustodian(mfgBatchId);
      expect(currentCust).to.equal(logistics.address);
    });

    it("물류사가 유통사로 최종 이관을 완성해야 함", async function () {
      await operations.connect(logistics).requestTransfer(
        mfgBatchId,
        distributor.address,
        "서울 물류배송센터",
        "이상 없이 정상 인도"
      );

      await operations.connect(distributor).acceptTransfer(mfgBatchId);

      const currentCust = await operations.getCurrentCustodian(mfgBatchId);
      expect(currentCust).to.equal(distributor.address);
    });
  });

  describe("5. 결함 발생 및 리콜(Recall) 동적 처리", function () {
    const mfgBatchId = "MFG-EXTRACT-20260811";

    it("권한 보유자(검사기관)가 리콜을 발령하면 배치 상태가 RECALLED로 전환되고 추가 이관이 차단되어야 함", async function () {
      // 1. 리콜 발령
      await operations.connect(inspector).triggerRecall(mfgBatchId, "특정 원료 용기 교차오염 우려로 인한 예방적 리콜");

      const status = await operations.getBatchStatus(mfgBatchId);
      expect(status).to.equal(2); // 2 = RECALLED

      // 2. 리콜 조치된 배치의 추가 이관 시도 시 실패
      await expect(
        operations.connect(distributor).requestTransfer(
          mfgBatchId,
          supplier.address,
          "반품창고",
          "리콜 반품 시도"
        )
      ).to.be.revertedWith("Batch is recalled");
    });
  });
});
