# ChainTrace Step 1 완료 보고서 (원료 공급사 전용 웹 무역원장 포탈)

---

## 1. 개요 (Overview)

- **Step 1 목표**: 각 참여 회사별 독립 웹 서버 환경을 가상하여, **원료 공급사(Supplier) 전용 웹 무역원장 기록 포탈**을 개발하고 온체인 서명 수록 ➔ DuckDB 고속 인덱싱 ➔ 무역원장 전자증명서 카드 발급까지 엔드투엔드 검증 완료
- **완료 일자**: 2026-08-11
- **개발 언어 및 스택**: HTML5, Vanilla JavaScript, CSS3 (Dark Mode Modern UI), Node.js, Express, Ethers.js v6, DuckDB

---

## 2. 구현된 주요 파일 목록

| 파일 경로 | 구분 | 설명 |
| :--- | :--- | :--- |
| [`public/supplier_portal.html`](file:///c:/apps/ChainTrace/public/supplier_portal.html) | Web UI | 원료 수급 무역원장 작성 폼, 서명 버튼, 온체인 전자증명서 카드 및 수록 이력 목록 |
| [`server/routes/supplier.js`](file:///c:/apps/ChainTrace/server/routes/supplier.js) | Backend API | 원료 무역원장 등록 (`POST /api/supplier/create-batch`) 및 원료사별 배치 조회 API |
| [`server/index.js`](file:///c:/apps/ChainTrace/server/index.js) | Express Server | `public/` 정적 웹 포탈 서빙 및 `/api/supplier` 라우터 등록 |
| [`scripts/test_supplier_portal.js`](file:///c:/apps/ChainTrace/scripts/test_supplier_portal.js) | Verification | 원료사 웹 포탈 폼 입력 ➔ 온체인 트랜잭션 ➔ DuckDB 색인 ➔ API 조회 독립 테스트 |

---

## 3. 원료 공급사 웹 무역원장 포탈 UI 및 주요 기능

1. **접속 원료사 선택 (Multi-tenant Supplier Wallet Selection)**:
   - 10개 원료사 중 접속 회사 선택 (예: "금산유기농원료(주)", "풍기인삼농업협동조합" 등)
   - 선택 시 해당 원료사의 온체인 이더리움 지갑 주소(`0x7099...`)가 자동 바인딩됨
2. **원료 무역원장 작성 폼 (Raw Material Entry Form)**:
   - 배치 ID 입력 (자동 생성 `[⚡ 자동생성]` 버튼 지원: `RAW-SUP01-20260811-001`)
   - 원료 품목명, 수량 및 단위, 생산지 위치, 품질 메타데이터(IPFS) 입력
3. **블록체인 무역원장 전자서명 & 온체인 수록**:
   - `[ 🖊️ 블록체인 무역원장 전자서명 및 수록 ]` 클릭 시 `ChainTraceRegistry.sol`의 `createRawMaterialBatch()` 호출
4. **디지털 무역원장 전자증명서 실시간 발행 Card**:
   - 트랜잭션 해시(`0xca47...`), 블록 번호(`#880`), 수록 타임스탬프, `CONFIRMED ON CHAIN` 뱃지 및 발행 카드 실시간 출력
5. **온체인 수록 원료 이력 목록 (DuckDB 연동)**:
   - 선택된 원료사가 온체인에 영구 기록한 1차 원료 배치 이력 실시간 목록 조회

---

## 4. 백엔드 API 명세서

| 엔드포인트 | 메서드 | 설명 |
| :--- | :--- | :--- |
| `POST /api/supplier/create-batch` | `POST` | 원료 무역원장 데이터 수신 ➔ 온체인 트랜잭션 서명 기록 ➔ DuckDB 인덱싱 ➔ **무역원장 전자증명서 반환** |
| `GET /api/supplier/batches/:address` | `GET` | 특정 원료사 주소가 등록한 전체 1차 원료 배치 목록 반환 |

---

## 5. 자동화 검증 결과 (`node scripts/test_supplier_portal.js`)

`node scripts/test_supplier_portal.js` 검증 스크립트를 통해 100% 통과 확인되었습니다:

```shell
==========================================================================
 🧪 ChainTrace Step 1: 원료 공급사 웹 무역원장 포탈 통합 검증
==========================================================================

📍 [Step 1-1] 원료 공급사 포탈 API 서버 포트 5002 바인딩 완료
 1) 원료 수급 폼 입력 ➔ 온체인 무역원장 서명 등록 테스트 (배치: RAW-TEST-1786452182721)...
📝 [원료사 무역원장 등록 요청] 서명자: 0x70997970C51812dc3A010C7d01b50e0d17dc79C8 | 배치: RAW-TEST-1786452182721
 ✅ 온체인 트랜잭션 수록 성공!
    - 트랜잭션 해시: 0xca474295ce315a4962e8cf835290a5081fb6d769d0a296b305021082dd964303
    - 블록 번호    : #880
    - 발행 상태    : CONFIRMED_ON_CHAIN

 2) DuckDB 데이터베이스 수록 여부 확인...
 ✅ DuckDB 수록 확인: [RAW-TEST-1786452182721] 6년근 유기농 청정 수삼 (테스트) (1500 kg)

 3) 원료사 수록 배치 목록 GET API 조회 테스트...
 ✅ 원료사 등록 배치 목록 API 응답: 총 15개 배치 수록 확인!

==========================================================================
 🎉 Step 1: 원료 공급사 전용 웹 무역원장 포탈 검증 100% 성공!
==========================================================================
```

---

## 6. 웹 포탈 직접 확인 방법

1. 백엔드 서버 구동:
   ```bash
   node server/index.js
   ```
2. 웹 브라우저 접속:
   `http://localhost:5000/supplier_portal.html`

---

## 7. 다음 단계 (Step 2 안내 및 승인 요청)

**[Step 2] 제조사(Manufacturer) 전용 웹 무역원장 포탈 및 테스트 구축**
- **주요 내용**:
  1. 원료사가 등록한 상위 원료 배치 목록(`parentBatchIds`)을 웹에서 다중 선택
  2. 완제품 제조 폼 작성 (배치 ID, 완제품명, 수량, 단위, 메타데이터)
  3. `createManufacturedBatch()` 온체인 호출하여 원료-완제품 계보(Genealogy) 연결
  4. 제조사 전용 무역원장 전자증명서 발행 웹 포탈 ([`public/manufacturer_portal.html`](file:///c:/apps/ChainTrace/public/manufacturer_portal.html)) 구현
  5. 독립 검증 테스트 스크립트 작성 (`node scripts/test_manufacturer_portal.js`) 및 보고서 제출

Step 2 진행을 승인하시려면 **"진행해"**라고 입력해 주시기 바랍니다!
