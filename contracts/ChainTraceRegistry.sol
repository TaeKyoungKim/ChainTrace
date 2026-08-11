// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * @title ChainTraceRegistry
 * @notice 참여자 역할 등록, 원료 및 완제품 배치(Batch) 생성과 상위-하위 계보(Genealogy) 기록을 담당하는 스마트 컨트랙트
 */
contract ChainTraceRegistry is AccessControl {
    // 5대 핵심 참여자 역할 정의
    bytes32 public constant SUPPLIER_ROLE = keccak256("SUPPLIER_ROLE");
    bytes32 public constant MANUFACTURER_ROLE = keccak256("MANUFACTURER_ROLE");
    bytes32 public constant INSPECTOR_ROLE = keccak256("INSPECTOR_ROLE");
    bytes32 public constant LOGISTICS_ROLE = keccak256("LOGISTICS_ROLE");
    bytes32 public constant DISTRIBUTOR_ROLE = keccak256("DISTRIBUTOR_ROLE");

    enum BatchType { RAW_MATERIAL, MANUFACTURED }

    struct ParticipantInfo {
        string companyName;
        bytes32 role;
        bool isRegistered;
        uint256 registeredAt;
    }

    struct Batch {
        string batchId;
        BatchType batchType;
        address creator;
        string productName;
        uint256 quantity;
        string unit;
        uint256 createdAt;
        string[] parentBatchIds; // 하위 원료/배치 ID 계보
        string metadataHash;
        bool exists;
    }

    // 매핑 상태 저장소
    mapping(address => ParticipantInfo) private _participants;
    mapping(string => Batch) private _batches;
    string[] private _allBatchIds;

    // 이벤트 정의
    event ParticipantRegistered(address indexed participant, bytes32 indexed role, string companyName);
    event ParticipantRevoked(address indexed participant, bytes32 indexed role);
    event BatchCreated(
        string indexed batchId,
        BatchType batchType,
        address indexed creator,
        string productName,
        uint256 quantity,
        string unit,
        string[] parentBatchIds,
        string metadataHash,
        uint256 timestamp
    );

    constructor() {
        // 배포자를 DEFAULT_ADMIN_ROLE로 설정
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    /**
     * @notice 참여자 등록 (Admin 전용)
     */
    function registerParticipant(
        address participant,
        bytes32 role,
        string memory companyName
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(participant != address(0), "Invalid address");
        require(bytes(companyName).length > 0, "Company name required");
        require(
            role == SUPPLIER_ROLE ||
            role == MANUFACTURER_ROLE ||
            role == INSPECTOR_ROLE ||
            role == LOGISTICS_ROLE ||
            role == DISTRIBUTOR_ROLE,
            "Invalid role"
        );

        _grantRole(role, participant);
        _participants[participant] = ParticipantInfo({
            companyName: companyName,
            role: role,
            isRegistered: true,
            registeredAt: block.timestamp
        });

        emit ParticipantRegistered(participant, role, companyName);
    }

    /**
     * @notice 참여자 권한 해제 (Admin 전용)
     */
    function revokeParticipant(address participant, bytes32 role) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_participants[participant].isRegistered, "Participant not registered");
        _revokeRole(role, participant);
        _participants[participant].isRegistered = false;

        emit ParticipantRevoked(participant, role);
    }

    /**
     * @notice 원료 배치 생성 (SUPPLIER 전용)
     */
    function createRawMaterialBatch(
        string memory batchId,
        string memory productName,
        uint256 quantity,
        string memory unit,
        string memory metadataHash
    ) external onlyRole(SUPPLIER_ROLE) {
        require(bytes(batchId).length > 0, "Batch ID required");
        require(!_batches[batchId].exists, "Batch ID already exists");
        require(bytes(productName).length > 0, "Product name required");
        require(quantity > 0, "Quantity must be > 0");

        string[] memory emptyParents;

        _batches[batchId] = Batch({
            batchId: batchId,
            batchType: BatchType.RAW_MATERIAL,
            creator: msg.sender,
            productName: productName,
            quantity: quantity,
            unit: unit,
            createdAt: block.timestamp,
            parentBatchIds: emptyParents,
            metadataHash: metadataHash,
            exists: true
        });

        _allBatchIds.push(batchId);

        emit BatchCreated(
            batchId,
            BatchType.RAW_MATERIAL,
            msg.sender,
            productName,
            quantity,
            unit,
            emptyParents,
            metadataHash,
            block.timestamp
        );
    }

    /**
     * @notice 완제품/제조 배치 생성 (MANUFACTURER 전용, 원료 배치 계보 연결)
     */
    function createManufacturedBatch(
        string memory batchId,
        string memory productName,
        uint256 quantity,
        string memory unit,
        string[] memory parentBatchIds,
        string memory metadataHash
    ) external onlyRole(MANUFACTURER_ROLE) {
        require(bytes(batchId).length > 0, "Batch ID required");
        require(!_batches[batchId].exists, "Batch ID already exists");
        require(bytes(productName).length > 0, "Product name required");
        require(quantity > 0, "Quantity must be > 0");
        require(parentBatchIds.length > 0, "Parent batch IDs required");

        // 상위 원료 배치들의 존재 여부 검증
        for (uint256 i = 0; i < parentBatchIds.length; i++) {
            require(_batches[parentBatchIds[i]].exists, "Parent batch does not exist");
        }

        _batches[batchId] = Batch({
            batchId: batchId,
            batchType: BatchType.MANUFACTURED,
            creator: msg.sender,
            productName: productName,
            quantity: quantity,
            unit: unit,
            createdAt: block.timestamp,
            parentBatchIds: parentBatchIds,
            metadataHash: metadataHash,
            exists: true
        });

        _allBatchIds.push(batchId);

        emit BatchCreated(
            batchId,
            BatchType.MANUFACTURED,
            msg.sender,
            productName,
            quantity,
            unit,
            parentBatchIds,
            metadataHash,
            block.timestamp
        );
    }

    // --- 조회 함수 (View Functions) ---

    function getBatch(string memory batchId) external view returns (
        string memory id,
        BatchType batchType,
        address creator,
        string memory productName,
        uint256 quantity,
        string memory unit,
        uint256 createdAt,
        string[] memory parentBatchIds,
        string memory metadataHash
    ) {
        require(_batches[batchId].exists, "Batch does not exist");
        Batch memory b = _batches[batchId];
        return (
            b.batchId,
            b.batchType,
            b.creator,
            b.productName,
            b.quantity,
            b.unit,
            b.createdAt,
            b.parentBatchIds,
            b.metadataHash
        );
    }

    function batchExists(string memory batchId) external view returns (bool) {
        return _batches[batchId].exists;
    }

    function getParticipant(address participant) external view returns (
        string memory companyName,
        bytes32 role,
        bool isRegistered,
        uint256 registeredAt
    ) {
        ParticipantInfo memory info = _participants[participant];
        return (info.companyName, info.role, info.isRegistered, info.registeredAt);
    }

    function getAllBatchIds() external view returns (string[] memory) {
        return _allBatchIds;
    }
}
