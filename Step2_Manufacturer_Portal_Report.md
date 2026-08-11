# ChainTrace Step 2 완료 보고서 (제조사 전용 웹 무역원장 포탈 & 결함 시나리오 처리)

---

## 1. 개요 (Overview)

- **Step 2 목표**: 각 참여 회사별 독립 웹 서버 환경을 가상하여, **제조사(Manufacturer) 전용 웹 무역원장 포탈**을 개발하고 **상위 원료 배치 계보(Genealogy) 연결 완제품 생산 수록** 및 **리콜/격리 원료 투입 차단**, **제조사 자발적 온체인 리콜 발령 결함 시나리오**까지 엔드투엔드 검증 완료
- **완료 일자**: 2026-08-11
- **개발 언어 및 스택**: HTML5, Vanilla JavaScript, CSS3 (Modern Dark Mode UI), Node.js, Express, Ethers.js v6, DuckDB

---

## 2. 구현된 주요 파일 목록

| 파일 경로 | 구분 | 설명 |
| :--- | :--- | :--- |
| [`public/manufacturer_portal.html`](file:///c:/apps/ChainTrace/public/manufacturer_portal.html) | Web UI | 상위 원료 배치 다중 선택, 완제품 제조 폼, 결함 원료 차단 경고, 자발적 온체인 리콜 발령 버튼 |
| [`server/routes/manufacturer.js`](file:///c:/apps/ChainTrace/server/routes/manufacturer.js) | Backend API | 원료 상태 조회(`GET`), 완제품 계보 연결 수록(`POST`), 자자 리콜 발령(`POST`), 제조 배치 목록(`GET`) |
| [`server/index.js`](file:///c:/apps/ChainTrace/server/index.js) | Express Server | Express API 서버에 `/api/manufacturer` 라우터 등록 |
| [`scripts/test_manufacturer_portal.js`](file:///c:/apps/ChainTrace/scripts/test_manufacturer_portal.js) | Verification | 정상 완제품 제조, **리콜 원료 투입 차단 시나리오**, **자발적 리콜 발령** 엔드투엔드 검증 |

---

## 3. 제조사 웹 무역원장 포탈 UI 및 주요 결함 처리 시나리오

1. **상위 원료 배치 다중 선택 (Parent Raw Batch Genealogy Selection)**:
   - 등록된 원료 배치 목록을 실시간 조회하여 체크박스로 투입할 원료를 선택
2. **🚨 결함 시나리오 1: 리콜/격리 원료 투입 사전 차단 (Web & API Validation)**:
   - `RECALLED` 또는 `QUARANTINED` 상태인 원료 배치는 웹 화면에서 `🚨 RECALLED (사용 불가)` 경고 뱃지가 표시되며 선택이 **자동 비활성화**됨
   - 비정상적인 요청으로 리콜 원료 투입 시도 시 API 서버 및 스마트 컨트랙트에서 `400 Bad Request` ("🚨 제조 거부: 선택하신 원료 배치는 리콜 상태이므로 제조에 투입할 수 없습니다!") 에러 반환
3. **완제품 무역원장 전자서명 & 계보 수록**:
   - `[ 🖊️ 완제품 무역원장 전자서명 및 계보 연결 ]` 클릭 시 제조사 개인키로 트랜잭션을 서명하여 `createManufacturedBatch()` 호출 및 완제품 전자증명서 카드 실시간 출력
4. **🚨 결함 시나리오 2: 제조사 자발적 온체인 리콜 발령 (Manufacturer Self-Recall)**:
   - 본인이 제조한 완제품 목록에서 공정 결함 발견 시 `[ 🚨 온체인 리콜 발령 ]` 버튼 클릭 ➔ 온체인 `triggerRecall()` 발령 및 `RECALLED` 상태 전환

---

## 4. 백엔드 API 명세서

| 엔드포인트 | 메서드 | 설명 |
| :--- | :--- | :--- |
| `GET /api/manufacturer/raw-batches` | `GET` | 투입 가능 1차 원료 배치 목록 및 리콜/격리 유효 상태 반환 |
| `POST /api/manufacturer/create-batch` | `POST` | 리콜 원료 투입 검증 ➔ 완제품 제조 온체인 수록 ➔ DuckDB 계보(Genealogy) 연결 |
| `POST /api/manufacturer/trigger-recall` | `POST` | 제조사 본인의 완제품 배치에 대해 온체인 리콜 발령 수록 |
| `GET /api/manufacturer/batches/:address` | `GET` | 특정 제조사가 생산한 전체 완제품 배치 목록 및 리콜 상태 반환 |

---

## 5. 자동화 검증 결과 (`node scripts/test_manufacturer_portal.js`)

`node scripts/test_manufacturer_portal.js` 검증 스크립트를 통해 100% 통과 확인되었습니다:

```shell
==========================================================================
 🧪 ChainTrace Step 2: 제조사 웹 무역원장 포탈 & 결함 시나리오 차단 검증
==========================================================================

 1) 투입 가능 원료 배치 목록 API 조회...
 ✅ 정상 원료 배치 확인: [RAW-SUP09-D14] (영주 산삼 (영주인삼원료사))
 🚨 리콜 원료 배치 확인: [RAW-SUP02-D03] (지리산 당귀 (풍기인삼농업))

 2) 정상 원료 [RAW-SUP09-D14] 투입 ➔ 완제품 [MFG-TEST-1786453121136] 제조 서명 수록...
📝 [제조사 완제품 무역원장 등록] 제조사: 0x71bE63f3384f5fb98995898A86B02Fb2426c5788 | 완제품: MFG-TEST-1786453121136 | 원료: RAW-SUP09-D14
 ✅ 온체인 완제품 무역원장 수록 성공!
    - 트랜잭션 해시 : 0x9df285cf463fe7f1b7f05d49e1656e661903648e98cec921b0b6575758df6347
    - 연결된 원료   : RAW-SUP09-D14

 3) 🧪 [시나리오 차단 검증] 리콜 원료 [RAW-SUP02-D03] 투입 제조 시도 중...
 ✅ 예상대로 리콜 원료 투입 제조가 차단되었습니다! (사유: 🚨 제조 거부: 선택하신 원료 배치 [RAW-SUP02-D03]는 리콜(RECALLED) 상태이므로 제조에 투입할 수 없습니다!)

 4) 🚨 제조사 자발적 온체인 리콜 발령 시뮬레이션 [MFG-TEST-1786453121136]...
🚨 [제조사 자발적 리콜 발령] 배치: MFG-TEST-1786453121136 | 사유: 포장 포일 이물질 미세 혼입 우려로 인한 자발적 온체인 리콜
 ✅ 제조사 자발적 온체인 리콜 발령 성공!
    - 리콜 배치 ID  : MFG-TEST-1786453121136
    - 리콜 사유     : 포장 포일 이물질 미세 혼입 우려로 인한 자발적 온체인 리콜
    - 트랜잭션 해시 : 0x1ea36e84b74b02c2a4f632bf3708e8a4d9dda1ff175d3d5c3d15177688d3e89d

==========================================================================
 🎉 Step 2: 제조사 웹 무역원장 포탈 & 리콜 차단 검증 100% 성공!
==========================================================================
```

---

## 6. 웹 포탈 직접 확인 방법

1. 백엔드 서버 구동:
   ```bash
   node server/index.js
   ```
2. 웹 브라우저 접속:
   - **원료 공급사 포탈**: `http://localhost:5000/supplier_portal.html`
   - **제조사 포탈**: `http://localhost:5000/manufacturer_portal.html`

---

## 7. 다음 단계 (Step 3 안내 및 승인 요청)

**[Step 3] 검사기관(Inspector) 전용 웹 무역원장 포탈 및 테스트 구축**
- **주요 내용**:
  1. 5개 공인 검사기관(국가식품품질검사원, 한국의약품시험연구원 등) 전용 포탈 구현 ([`public/inspector_portal.html`](file:///c:/apps/ChainTrace/public/inspector_portal.html))
  2. 등록된 원료/완제품 선택 ➔ 시험 성적서 결과(합격/불합격), 파라미터 상세 기록 및 IPFS 성적서 해시 온체인 수록 (`recordInspection()`)
  3. **🚨 결함 시나리오 처리**: 검사 불합격 등록 시 배치 상태가 자동으로 `QUARANTINED`(격리)로 변경되는 시나리오 검증
  4. 독립 검증 테스트 (`node scripts/test_inspector_portal.js`) 및 보고서 제출

Step 3 진행을 승인하시려면 **"진행해"**라고 입력해 주시기 바랍니다!
