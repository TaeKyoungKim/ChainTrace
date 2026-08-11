# ChainTrace: 블록체인 기반 공급망 이력 관리 및 LangGraph AI Agent 시스템 구축 제안서

---

## 1. 프로젝트 개요 (Executive Summary)

**ChainTrace**는 원료 공급사, 제조사, 물류사, 검사기관, 유통사에 이르는 전체 공급망(Supply Chain)의 모든 핵심 이벤트(원료 채취/생산, 완제품 제조, 품질 검사 성적서, 물류 인수/인도, 리콜 처리)를 **무단 변경이 불가능한 블록체인 스마트 컨트랙트**에 기록하여 상호 신뢰를 확보하고, 그 위에 **LangGraph 기반의 AI Agent**를 구축하여 이력 조회, 품질 대조, 상태 추적, 규정 검증을 자연어로 간편하게 수행할 수 있는 차세대 지능형 공급망 관리 플랫폼입니다.

---

## 2. 프로젝트 목표 및 특징

1. **상호 신뢰성 확보 (Blockchain Trust Layer)**
   - 다양한 이해관계자가 참여하는 네트워크에서 데이터 위·변조를 방지.
   - 2개의 전용 스마트 컨트랙트로 역할 분담 및 책임 명확화.
2. **지능형 질의응답 및 감시 (LangGraph AI Agent)**
   - 블록체인의 정형화된 데이터와 규정/품질문서를 유기적으로 연결하여 사용자의 질의에 실시간 검증 답변 제공.
   - 규정 준수 대조(Compliance Audit) 자동화.
3. **순수 Node.js (Pure JavaScript) 스택 준수**
   - TypeScript의 복잡한 컴파일 과정 없이 직관적이고 표준적인 **Node.js (JavaScript)**로 전체 시스템 백엔드 및 AI 에이전트 통합.

---

## 3. 참여자 역할 및 권한 구조 (Stakeholders)

| 참여자 구분 | 주요 역할 및 권한 |
| :--- | :--- |
| **원료 공급사 (Supplier)** | · 원료 배치(Raw Material Batch) 생성 및 원산지/품질 데이터 블록체인 등록 |
| **제조사 (Manufacturer)** | · 원료 배치를 조합하여 완제품 배치(Manufactured Batch) 생성 및 계보(Genealogy) 연결 |
| **검사기관 (Inspector)** | · 제품/원료에 대한 시험 성적서 발행, 블록체인 상 품질 검사 결과(Pass/Fail) 서명 등록 |
| **물류사 (Logistics)** | · 단계별 운송 시 운송 상태, 온도/습도 등 환경 기록 및 인수/인도(Custody Handover) 등록 |
| **유통사 (Distributor)** | · 최종 입고 및 판매 배치 수령 확인, 소비자 대상 트랙앤트레이스 이력 제공 |

---

## 4. 스마트 컨트랙트 설계 (2 Smart Contracts)

### 4.1. Contract 1: `ChainTraceRegistry.sol` (참여자 및 제품 배치 등록)
- **참여자 관리 (Participant Management)**
  - Address별 역할(Role) 부여: `SUPPLIER`, `MANUFACTURER`, `INSPECTOR`, `LOGISTICS`, `DISTRIBUTOR`
  - 권한 검증 modifier (`onlyRole`) 구현
- **배치 생성 및 계보 추적 (Batch & Genealogy Registry)**
  - 배치(Batch) ID, 생산자, 생산일자, 시리얼, 메타데이터 해시 기록
  - 완제품 배치 생성 시 포함된 원료 배치 ID 목록(Parent Batch IDs) 연결 구조 지원

### 4.2. Contract 2: `ChainTraceOperations.sol` (이관, 품질검사, 리콜)
- **소유권 및 인수/인도 이관 (Custody Transfer)**
  - `transferCustody(batchId, toAddress, locationData)`
  - 수령자의 승인(`acceptCustody`) 프로세스를 통한 이중 검증
- **품질 검사 기록 (Quality Inspection)**
  - `recordInspection(batchId, passOrFail, certHash, testDetails)`
  - 검사기관 권한(`onlyRole(INSPECTOR)`) 소유자만 기록 가능
- **리콜 처리 (Recall Triggering)**
  - `triggerRecall(batchId, reasonHash)`
  - 결함 발견 시 해당 배치 및 연관 하위/상위 배치를 격리(`Quarantined`) 및 리콜(`Recalled`) 상태로 동적 전환

---

## 5. LangGraph AI Agent 아키텍처

AI Agent는 사용자의 자연어 질문을 해석하여 적절한 도구(Tools)를 실행하고 온체인 데이터 및 문서 데이터베이스와 대조합니다.

```
                  ┌────────────────────────┐
                  │      User Question     │
                  └───────────┬────────────┘
                              │
                              ▼
                  ┌────────────────────────┐
                  │    Router Node (AI)    │
                  └───────────┬────────────┘
                              │
        ┌─────────────────────┼─────────────────────┬─────────────────────┐
        ▼                     ▼                     ▼                     ▼
┌───────────────┐     ┌───────────────┐     ┌───────────────┐     ┌───────────────┐
│ Batch History │     │ Current Status│     │  Compliance   │     │ Doc/Code RAG  │
│  Query Tool   │     │  Query Tool   │     │  Audit Tool   │     │  Search Tool  │
└───────┬───────┘     └───────┬───────┘     └───────┬───────┘     └───────┬───────┘
        │                     │                     │                     │
        └─────────────────────┼─────────────────────┴─────────────────────┘
                              │
                              ▼
                  ┌────────────────────────┐
                  │  Response Formatter    │
                  └───────────┬────────────┘
                              │
                              ▼
                  ┌────────────────────────┐
                  │ Verified AI Answer & UI│
                  └────────────────────────┘
```

### AI Agent 핵심 4대 기능
1. **문서/코드 검색조회 (Doc/Code Search)**: 스마트 컨트랙트 ABI 사양, 시스템 규정 문서, 가이드라인 RAG 조회
2. **히스토리 조회 (Genealogy History Trace)**: 특정 배치의 원료 수급부터 제조, 검사, 물류 이동 전체 타임라인 파악
3. **현재상태 조회 (Current Status Check)**: 현재 보관자, 위치, 검사 통과 여부, 리콜 발령 여부 실시간 조회
4. **규정대조 기능 (Compliance Audit)**: 개별 배치의 품질 검사 파라미터가 성적서 규정 기준에 부합하는지 자동 대조

---

## 6. 기술 스택 (Technology Stack)

- **Smart Contracts**: Solidity ^0.8.20, OpenZeppelin Contracts
- **Contract Testing & Dev**: Hardhat, Mocha, Chai (**Pure JavaScript - `hardhat.config.js`**)
- **Backend Server**: Node.js, Express, Ethers.js v6 (**Pure JavaScript - `.js`**)
- **Database**: SQLite / LevelDB (이벤트 인덱싱 및 빠른 조회용)
- **AI Agent Framework**: `@langchain/langgraph`, `@langchain/core` (**Node.js Pure JavaScript**)
- **Frontend Dashboard**: React, Vite, TailwindCSS / Custom Styling (Modern Sleek Dark Interface)

---

## 7. 단계별 추진 로드맵 및 운영 원칙
1. **단계별 사전 승인**: 매 단계(Phase) 진입 전 구체적인 개발 내용을 안내하고 승인을 받습니다.
2. **단계별 완료 결과 문서화**: 각 Phase의 구현 및 검증이 끝날 때마다 생성된 파일, 스마트 컨트랙트 사양, 테스트 실행 결과, 사용 가이드를 포함하는 완료 보고서 문서(`Phase1_Completion_Report.md` 등)를 프로젝트 내에 작성합니다.

```
[Phase 1] 스마트 컨트랙트 2종 구현 & Hardhat Pure JS 테스트 환경 구축
   │ ──▶ [Phase 1 완료 보고서 작성]
   ├──▶ 승인 후 진행
   │
[Phase 2] Node.js Ethers.js 백엔드 & 이벤트 인덱서 구현
   │ ──▶ [Phase 2 완료 보고서 작성]
   ├──▶ 승인 후 진행
   │
[Phase 3] LangGraph JS AI Agent & 4대 도구(Tools) 구현
   │ ──▶ [Phase 3 완료 보고서 작성]
   ├──▶ 승인 후 진행
   │
[Phase 4] 모던 UI 대시보드 & 통합 시나리오 검증 및 인도
     ──▶ [최종 통합 보고서 작성]
```

---

## 8. 승인 및 시작 안내

본 시스템 제안서를 확인하시고 **"진행해"**라고 입력해 주시면, **Phase 1(스마트 컨트랙트 개발 및 개발환경 구축)**부터 차근차근 승인을 받으며 구현을 시작합니다.
