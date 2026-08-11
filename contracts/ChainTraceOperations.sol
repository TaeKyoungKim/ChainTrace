// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "./ChainTraceRegistry.sol";

/**
 * @title ChainTraceOperations
 * @notice 소유/인수도 이관(Custody Transfer), 품질검사 성적서 기록 및 리콜(Recall) 처리를 담당하는 스마트 컨트랙트
 */
contract ChainTraceOperations {
    ChainTraceRegistry public registry;

    enum BatchStatus { NORMAL, QUARANTINED, RECALLED }
    enum InspectionResult { UNTESTED, PASSED, FAILED }

    struct InspectionRecord {
        address inspector;
        bool isPassed;
        string certHash;      // 시험성적서 IPFS / 문서 해시
        string testDetails;   // 검사 항목 및 파라미터 메모
        uint256 timestamp;
    }

    struct TransferRequest {
        address from;
        address to;
        string location;
        string notes;
        uint256 timestamp;
        bool isPending;
        bool isCompleted;
    }

    // 상태 매핑
    mapping(string => address) private _currentCustodians;
    mapping(string => BatchStatus) private _batchStatuses;
    mapping(string => InspectionRecord[]) private _inspectionRecords;
    mapping(string => TransferRequest) private _pendingTransfers;

    // 이벤트 정의
    event TransferRequested(string indexed batchId, address indexed from, address indexed to, string location);
    event TransferCompleted(string indexed batchId, address indexed from, address indexed to);
    event InspectionRecorded(string indexed batchId, address indexed inspector, bool isPassed, string certHash, string testDetails);
    event RecallTriggered(string indexed batchId, address indexed triggeredBy, string reason, uint256 timestamp);

    modifier onlyRole(bytes32 role) {
        require(registry.hasRole(role, msg.sender), "AccessControl: sender missing role");
        _;
    }

    modifier onlyCustodian(string memory batchId) {
        address current = _currentCustodians[batchId];
        // 최초 보관자가 등록되지 않았다면 Registry의 creator인지 확인
        if (current == address(0)) {
            (, , address creator, , , , , , ) = registry.getBatch(batchId);
            require(msg.sender == creator, "Not current custodian or creator");
        } else {
            require(msg.sender == current, "Not current custodian");
        }
        _;
    }

    constructor(address registryAddress) {
        require(registryAddress != address(0), "Invalid registry address");
        registry = ChainTraceRegistry(registryAddress);
    }

    /**
     * @notice 현재 보관자가 인수도 이관 요청
     */
    function requestTransfer(
        string memory batchId,
        address toAddress,
        string memory location,
        string memory notes
    ) external onlyCustodian(batchId) {
        require(registry.batchExists(batchId), "Batch does not exist");
        require(toAddress != address(0), "Invalid target address");
        require(_batchStatuses[batchId] != BatchStatus.RECALLED, "Batch is recalled");

        _pendingTransfers[batchId] = TransferRequest({
            from: msg.sender,
            to: toAddress,
            location: location,
            notes: notes,
            timestamp: block.timestamp,
            isPending: true,
            isCompleted: false
        });

        emit TransferRequested(batchId, msg.sender, toAddress, location);
    }

    /**
     * @notice 수령 대상자가 이관 요청 수락 및 소유권 변경 완료
     */
    function acceptTransfer(string memory batchId) external {
        TransferRequest storage request = _pendingTransfers[batchId];
        require(request.isPending, "No pending transfer for this batch");
        require(request.to == msg.sender, "Only designated recipient can accept");
        require(_batchStatuses[batchId] != BatchStatus.RECALLED, "Batch is recalled");

        request.isPending = false;
        request.isCompleted = true;
        _currentCustodians[batchId] = msg.sender;

        emit TransferCompleted(batchId, request.from, msg.sender);
    }

    /**
     * @notice 품질 검사 기록 등록 (INSPECTOR 전용)
     */
    function recordInspection(
        string memory batchId,
        bool isPassed,
        string memory certHash,
        string memory testDetails
    ) external onlyRole(registry.INSPECTOR_ROLE()) {
        require(registry.batchExists(batchId), "Batch does not exist");
        require(bytes(certHash).length > 0, "Cert hash required");

        _inspectionRecords[batchId].push(InspectionRecord({
            inspector: msg.sender,
            isPassed: isPassed,
            certHash: certHash,
            testDetails: testDetails,
            timestamp: block.timestamp
        }));

        // 검사 불합격 시 자동 격리(Quarantined) 상태로 변경
        if (!isPassed) {
            _batchStatuses[batchId] = BatchStatus.QUARANTINED;
        }

        emit InspectionRecorded(batchId, msg.sender, isPassed, certHash, testDetails);
    }

    /**
     * @notice 리콜 발령 (Admin, 검사기관, 또는 제조사/배치 생성자 가능)
     */
    function triggerRecall(string memory batchId, string memory reason) external {
        require(registry.batchExists(batchId), "Batch does not exist");
        bytes32 adminRole = registry.DEFAULT_ADMIN_ROLE();
        bytes32 inspectorRole = registry.INSPECTOR_ROLE();
        (, , address creator, , , , , , ) = registry.getBatch(batchId);

        require(
            registry.hasRole(adminRole, msg.sender) ||
            registry.hasRole(inspectorRole, msg.sender) ||
            msg.sender == creator,
            "Not authorized to trigger recall"
        );

        _batchStatuses[batchId] = BatchStatus.RECALLED;

        emit RecallTriggered(batchId, msg.sender, reason, block.timestamp);
    }

    // --- 조회 함수 (View Functions) ---

    function getCurrentCustodian(string memory batchId) public view returns (address) {
        address custodian = _currentCustodians[batchId];
        if (custodian == address(0) && registry.batchExists(batchId)) {
            (, , address creator, , , , , , ) = registry.getBatch(batchId);
            return creator;
        }
        return custodian;
    }

    function getBatchStatus(string memory batchId) external view returns (BatchStatus) {
        return _batchStatuses[batchId];
    }

    function getInspectionRecords(string memory batchId) external view returns (InspectionRecord[] memory) {
        return _inspectionRecords[batchId];
    }

    function getLatestInspectionStatus(string memory batchId) external view returns (InspectionResult) {
        InspectionRecord[] memory records = _inspectionRecords[batchId];
        if (records.length == 0) {
            return InspectionResult.UNTESTED;
        }
        return records[records.length - 1].isPassed ? InspectionResult.PASSED : InspectionResult.FAILED;
    }

    function getPendingTransfer(string memory batchId) external view returns (
        address from,
        address to,
        string memory location,
        string memory notes,
        uint256 timestamp,
        bool isPending
    ) {
        TransferRequest memory r = _pendingTransfers[batchId];
        return (r.from, r.to, r.location, r.notes, r.timestamp, r.isPending);
    }
}
