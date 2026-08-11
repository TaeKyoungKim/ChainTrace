# ChainTrace 스마트 컨트랙트 상세 기능 명세서

본 문서는 ChainTrace 시스템의 핵심 신뢰 레이어를 구성하는 2개의 스마트 컨트랙트 ([`ChainTraceRegistry.sol`](file:///c:/apps/ChainTrace/contracts/ChainTraceRegistry.sol) 및 [`ChainTraceOperations.sol`](file:///c:/apps/ChainTrace/contracts/ChainTraceOperations.sol))의 역할, 구조체, 이벤트, 제어Modifier 및 전체 함수 사양을 자세히 설명합니다.

---

## 1. 스마트 컨트랙트 1: `ChainTraceRegistry.sol`

### 1.1. 개요 및 역할 (Overview & Access Control)
OpenZeppelin의 `AccessControl`을 상속받아 공급망 네트워크에 참여하는 **5대 참여자 계정의 역할(Role)**을 등록/해제하고, 원료 및 완제품의 **배치(Batch) 생성 및 원료 계보(Genealogy) 연결**을 담당합니다.

#### 5대 참여자 역할 (Roles)
- `SUPPLIER_ROLE`: 원료 공급사 (원료 배치 생성 권한)
- `MANUFACTURER_ROLE`: 완제품 제조사 (완제품 배치 생성 및 상위 원료 배치 연결 권한)
- `INSPECTOR_ROLE`: 품질 검사기관 (검사 성적서 수록 권한)
- `LOGISTICS_ROLE`: 물류 운송사 (운송 및 이관 권한)
- `DISTRIBUTOR_ROLE`: 유통/판매사 (최종 수령 및 판촉 권한)
- `DEFAULT_ADMIN_ROLE`: 스마트 컨트랙트 배포자 (참여자 권한 부여/해제 관리자)

---

### 1.2. 데이터 구조 (Enums & Structs)

#### `enum BatchType`
- `RAW_MATERIAL` (0): 1차 원료 배치
- `MANUFACTURED` (1): 제조 완제품 배치

#### `struct ParticipantInfo`
- `companyName` (`string`): 법인/업체명 (예: "금산유기농원료(주)")
- `role` (`bytes32`): 부여된 5대 역할 식별자
- `isRegistered` (`bool`): 현재 유효한 등록 상태 여부
- `registeredAt` (`uint256`): 등록 타임스탬프

#### `struct Batch`
- `batchId` (`string`): 고유 배치 번호 (예: "RAW-GINSENG-20260811", "MFG-EXTRACT-20260811")
- `batchType` (`BatchType`): 원료 또는 완제품 구분
- `creator` (`address`): 배치를 최초 생성한 계정 주소
- `productName` (`string`): 제품/원료명
- `quantity` (`uint256`): 수량
- `unit` (`string`): 단위 (예: "kg", "box")
- `createdAt` (`uint256`): 생성 타임스탬프
- `parentBatchIds` (`string[]`): 원재료로 사용된 상위 배치 ID 목록 (계보 연결)
- `metadataHash` (`string`): 원산지 증명서, 상세 메타데이터 IPFS/문서 해시
- `exists` (`bool`): 배치 존재 여부 플래그

---

### 1.3. 이벤트 (Events)
- `ParticipantRegistered(address indexed participant, bytes32 indexed role, string companyName)`: 새로운 참여자가 등록되었을 때 발생
- `ParticipantRevoked(address indexed participant, bytes32 indexed role)`: 참여자 권한이 해제되었을 때 발생
- `BatchCreated(string indexed batchId, BatchType batchType, address indexed creator, string productName, uint256 quantity, string unit, string[] parentBatchIds, string metadataHash, uint256 timestamp)`: 새로운 배치가 생성되었을 때 발생

---

### 1.4. 주요 기능 함수 (Functions)

#### 1) `registerParticipant(address participant, bytes32 role, string memory companyName)`
- **접근 권한**: `onlyRole(DEFAULT_ADMIN_ROLE)` (Admin 전용)
- **기능**: 특정 Ethereum 주소에 5대 참여자 역할 중 하나를 부여하고 회사명을 기록합니다.

#### 2) `revokeParticipant(address participant, bytes32 role)`
- **접근 권한**: `onlyRole(DEFAULT_ADMIN_ROLE)` (Admin 전용)
- **기능**: 기존에 등록된 참여자의 권한을 박탈하고 등록 상태를 비활성화합니다.

#### 3) `createRawMaterialBatch(string batchId, string productName, uint256 quantity, string unit, string metadataHash)`
- **접근 권한**: `onlyRole(SUPPLIER_ROLE)` (원료사 전용)
- **기능**: 새로운 1차 원료 배치를 생성합니다. 상위 배치가 없으므로 `parentBatchIds`는 빈 배열로 저장됩니다.

#### 4) `createManufacturedBatch(string batchId, string productName, uint256 quantity, string unit, string[] parentBatchIds, string metadataHash)`
- **접근 권한**: `onlyRole(MANUFACTURER_ROLE)` (제조사 전용)
- **기능**: 하나 이상의 원료 배치(`parentBatchIds`)를 투입하여 완제품 배치를 생성합니다. 모든 입력 원료 배치의 실존 여부를 검증하여 **투명한 계보(Genealogy)**를 형성합니다.

#### 5) 조회 전용 함수 (View Functions)
- `getBatch(string batchId)`: 특정 배치의 전체 메타데이터 및 상위 원료 계보 목록 반환
- `batchExists(string batchId)`: 배치 존재 여부 확인
- `getParticipant(address participant)`: 등록된 참여자의 회사명 및 역할 정보 반환
- `getAllBatchIds()`: 현재 온체인에 등록된 전체 배치 ID 목록 반환

---

## 2. 스마트 컨트랙트 2: `ChainTraceOperations.sol`

### 2.1. 개요 및 제어 (Overview & Modifiers)
[`ChainTraceRegistry`](file:///c:/apps/ChainTrace/contracts/ChainTraceRegistry.sol)와 연동되어 배치의 **보관자/소유권 이관(Custody Transfer)**, **품질 검사 성적서 등록**, 그리고 **결함 발생 시 리콜(Recall) 발령 및 이동 차단**을 제어합니다.

#### 주요 Modifier
- `onlyRole(bytes32 role)`: Registry에 등록된 특정 역할 보유 여부 검증
- `onlyCustodian(string batchId)`: 해당 배치의 현재 온체인 보관자(최초 생성자 또는 이관 수락자)인지 검증

---

### 2.2. 데이터 구조 (Enums & Structs)

#### `enum BatchStatus`
- `NORMAL` (0): 정상 유통 상태
- `QUARANTINED` (1): 검사 불합격으로 인한 임시 격리 상태
- `RECALLED` (2): 리콜 발령 상태 (이관 및 유통 완전 차단)

#### `enum InspectionResult`
- `UNTESTED` (0): 검사 미실시
- `PASSED` (1): 품질 검사 합격
- `FAILED` (2): 품질 검사 불합격

#### `struct InspectionRecord`
- `inspector` (`address`): 검사를 수행한 검사기관 주소
- `isPassed` (`bool`): 합격(true) / 불합격(false) 여부
- `certHash` (`string`): 시험성적서 IPFS 또는 문서 해시
- `testDetails` (`string`): 성분 분석, 잔류농약, 시험 파라미터 상세 기록
- `timestamp` (`uint256`): 검사 수행 시간

#### `struct TransferRequest`
- `from` (`address`): 이관 요청자 (현재 보관자)
- `to` (`address`): 이관 수령 대상자
- `location` (`string`): 이동 출발/도착 장소 (예: "대전 중앙물류센터")
- `notes` (`string`): 운송 조건 및 메모 (예: "콜드체인 4도 유지")
- `timestamp` (`uint256`): 요청 시간
- `isPending` (`bool`): 인수 대기 중 여부
- `isCompleted` (`bool`): 이관 완료 여부

---

### 2.3. 이벤트 (Events)
- `TransferRequested(string indexed batchId, address indexed from, address indexed to, string location)`: 이관 요청 시 발생
- `TransferCompleted(string indexed batchId, address indexed from, address indexed to)`: 수령자가 이관을 수락하여 소유권이 이전되었을 때 발생
- `InspectionRecorded(string indexed batchId, address indexed inspector, bool isPassed, string certHash, string testDetails)`: 검사성적서가 등록되었을 때 발생
- `RecallTriggered(string indexed batchId, address indexed triggeredBy, string reason, uint256 timestamp)`: 리콜이 발령되었을 때 발생

---

### 2.4. 주요 기능 함수 (Functions)

#### 1) `requestTransfer(string batchId, address toAddress, string location, string notes)`
- **접근 권한**: `onlyCustodian(batchId)` (현재 보관자 전용)
- **기능**: 다음 수령 대상자(`toAddress`)에게 이관을 요청합니다. 배치가 `RECALLED` 상태인 경우 요청이 즉시 거부됩니다.

#### 2) `acceptTransfer(string batchId)`
- **접근 권한**: 지정된 수령 대상자(`to == msg.sender`) 전용
- **기능**: 대기 중인 이관 요청을 승인하여 온체인 현재 보관자(`_currentCustodians`)를 본인 주소로 갱신합니다.

#### 3) `recordInspection(string batchId, bool isPassed, string certHash, string testDetails)`
- **접근 권한**: `onlyRole(INSPECTOR_ROLE)` (품질 검사기관 전용)
- **기능**: 특정 배치의 검사 성적서 결과를 온체인에 영구 수록합니다. 검사 결과가 불합격(`isPassed == false`)일 경우 배치 상태를 자동으로 `QUARANTINED`(격리)로 변경합니다.

#### 4) `triggerRecall(string batchId, string reason)`
- **접근 권한**: Admin, 검사기관(`INSPECTOR_ROLE`), 또는 해당 배치의 최초 생성자만 호출 가능
- **기능**: 결함이 발견된 배치의 상태를 `RECALLED`로 지정합니다. 이 시점부터 해당 배치의 모든 인수도 이관이 원천 차단됩니다.

#### 5) 조회 전용 함수 (View Functions)
- `getCurrentCustodian(string batchId)`: 특정 배치의 현재 온체인 보관자 주소 반환 (이관 기록이 없으면 최초 생성자 반환)
- `getBatchStatus(string batchId)`: 현재 배치 상태 (`NORMAL`, `QUARANTINED`, `RECALLED`) 반환
- `getInspectionRecords(string batchId)`: 배치에 수록된 전체 품질 검사 이력 목록 반환
- `getLatestInspectionStatus(string batchId)`: 가장 최근 검사 통과 여부 (`UNTESTED`, `PASSED`, `FAILED`) 반환
- `getPendingTransfer(string batchId)`: 진행 중인 인수도 이관 요청 상세 반환

---

## 3. 5대 참여자 전체 업무 시나리오 연결 흐름

```
 [1. 원료사 (Supplier)]
   │ ──▶ createRawMaterialBatch() [원료 배치 생성]
   ▼
 [2. 제조사 (Manufacturer)]
   │ ──▶ createManufacturedBatch([원료배치ID]) [완제품 배치 생성 & 계보 연결]
   │ ──▶ requestTransfer(물류사) [물류 이관 요청]
   ▼
 [3. 물류사 (Logistics)]
   │ ──▶ acceptTransfer() [인수 확인]
   ▼
 [4. 검사기관 (Inspector)]
   │ ──▶ recordInspection(Pass, 성적서해시) [품질검사 등록]
   ▼
 [5. 유통사 (Distributor)]
   │ ──▶ acceptTransfer() [최종 유통망 입고]
   ▼
 [결함 발생 시] ──▶ triggerRecall() [리콜 발령 및 전체 이동 동적 차단]
```
