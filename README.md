# Chrome_Project_manager (chrome_tap_manager)

개발 목적으로 Chrome을 많이 쓰는 사용자를 위한 유틸리티. **작업마다 창 하나, 이름 하나 — 그 창이 곧 주제(Topic)**가 되고, 화면 한구석의 **Spotlight형 검색창**에서 키워드로 해당 탭이 있는 Chrome 창을 즉시 앞으로 불러온다. 정리 동작은 "이 탭을 저 주제로 보내기" 하나뿐이다.

두 가지 산출물 (기능 동일, 형태 상이):
- **Chrome Extension** — `extension/` (MV3, WXT + TypeScript)
- **Desktop 트레이 앱** — `desktop/` (Windows / macOS, Tauri v2) + `bridge/` (Native Messaging 프록시 호스트)

## 문서

| 문서 | 내용 |
|---|---|
| [docs/project_definition.md](docs/project_definition.md) | 원본 프로젝트 정의 |
| [docs/research.md](docs/research.md) | 기술 스택 리서치 (GitHub / Hugging Face / 웹) |
| [docs/functional_spec.md](docs/functional_spec.md) | 앱 기능정의서 (F-01..F-16, 비기능, 데이터 모델, 마일스톤) |
| [extension/DEV_PLAN.md](extension/DEV_PLAN.md) | Chrome Extension 마이크로 프로세스 개발 계획서 (E00~E12) |
| [history.md](history.md) | 개발 단계 대화 기록 (시계열, 원칙 1) |
| [protocol/](protocol/) | Extension ↔ Desktop Bridge 메시지 스키마 (유일한 공유 계약) |

## 운영 원칙

1. **앱 격리** — `extension/`, `desktop/`, `bridge/`는 독립 프로젝트. 폴더 간 import 금지. 공유는 `protocol/` 스키마만. 앱별 버전·태그(`ext-v*`, `desktop-v*`, `bridge-v*`).
2. **history.md** — 각 개발 단계의 요청·수행·결정·산출물을 시계열로 추가 기록 (기존 항목 수정 금지).
3. **README.md** — 아래 "진행 현황"과 "버전 히스토리"를 시계열로 유지.

---

## 진행 현황

최종 갱신: 2026-09-12

### 전체

| 영역 | 상태 | 비고 |
|---|---|---|
| 기획 문서 (정의서 / 리서치 / 기능정의서) | ✅ 완료 | 기능정의서 v0.2 — "창 = 주제" 모델 확정 |
| Extension 개발 계획서 | ✅ 완료 | `extension/DEV_PLAN.md` v0.2 |
| Extension 구현 | 🟡 E06 완료, E07 대기 | `ext-v0.2.0` (E04~E06, 테스트 174건). 팝업에서 `>move`/`>new`/`>rename`/`>open`/`>merge` 동작 |
| Desktop 앱 | ⬜ 미착수 | Extension EM5 이후 |
| Bridge 호스트 | ⬜ 미착수 | `protocol/` v0.1 이후 |
| Protocol 스키마 | ⬜ 미작성 | Extension E10에서 v0.1 |

### Extension 마이크로 스텝

| 스텝 | 내용 | 상태 | 완료일 |
|---|---|---|---|
| E00 | 저장소 골격 및 격리 구조 | ✅ 완료 | 2026-09-11 |
| E01 | WXT 스캐폴딩 | ✅ 완료 | 2026-09-11 |
| E02 | 도메인 모델 + 저장소 레이어 | ✅ 완료 | 2026-09-11 |
| E03 | 창·탭 이벤트 수집기 | ✅ 완료 | 2026-09-12 |
| E04 | Topic = 창 모델 | ✅ 완료 | 2026-09-12 |
| E05 | 검색 엔진 코어 + 커맨드 파서 | ✅ 완료 | 2026-09-12 |
| E06 | Popup 검색창 + 정리 커맨드 + IME | ✅ 완료 | 2026-09-12 |
| E07 | Omnibox | ⬜ | |
| E08 | Side Panel 개요 + 하위 그룹 (보조) | ⬜ | |
| E09 | 규칙: 행동 학습 제안 + 수동 규칙 | ⬜ | |
| E10 | Bridge 클라이언트 인터페이스 | ⬜ | |
| E11 | 세션 복원 + Topic 열기/닫기 | ⬜ | |
| E12 | 옵션 · 패키징 · 스토어 | ⬜ | |

---

## 버전 히스토리

| 날짜 | 버전 / 태그 | 커밋 | 내용 |
|---|---|---|---|
| 2026-09-12 | (미커밋) | — | **버그 수정**: 리로드 후 저장된 복제 주제를 복원하면 동일한 창이 하나 더 열리던 문제. 리로드·재시작 시 탭 지문(Jaccard ≥ 0.5)으로 기존 주제 재연결, 이름 없는 복제 저장 주제 자동 정리(≥ 0.8), 검색에서 열린 탭과 동일한 저장 탭 숨김. 테스트 180건 |
| 2026-09-12 | `ext-v0.2.0` | `9404ba5` | **EM2 완료.** E06 Popup 검색창 + 정리 커맨드: `core/commandRunner.ts`(focus/restore/move/new/rename/merge), `core/searchDocs.ts`, `core/ime.ts`, `chrome/actions.ts`, `TopicService.adoptWindow`, 백그라운드 검색 인덱스·컨텍스트 메뉴·단축키(Ctrl+Shift+M), Solid 팝업(검색·자동완성·키보드·IME 가드). 테스트 21건 추가 → 174건 |
| 2026-09-12 | (ext-v0.2.0에 포함) | `9404ba5` | E05 검색 엔진 코어 + 커맨드 파서: `core/search/{hangul,fuzzy,index}.ts`(MiniSearch 3중 필드 + fzf형 부분열 매칭, 랭킹 부스트), `core/command.ts`(`#`/`@saved`/`>` 문법, 7개 커맨드, 한글 인식 주제 자동완성). 테스트 39건 추가 → 153건, 1,100문서 쿼리 평균 1.3 ms |
| 2026-09-12 | (ext-v0.2.0에 포함) | `9404ba5` | E04 Topic = 창 모델: `core/topicService.ts`(창 생성→Topic, 창 닫힘→saved, 탭 행 동기화, rename/deleteSaved), `core/autoName.ts`, `Repo.batch()`, 세션 마커로 stale windowId 무효화, 팝업에 주제 목록·인라인 이름 변경. 테스트 28건 추가 → 114건 |
| 2026-09-12 | `ext-v0.1.0` | `de8396b` | **EM1 기반 완료.** E03 창·탭 이벤트 수집기 (`core/liveState.ts` 리듀서, `core/liveTracker.ts`, `chrome/events.ts`, 팝업에 라이브 상태·seq 표시, 테스트 37건 추가 → 86건) |
| 2026-09-11 | (ext-v0.1.0에 포함) | `de8396b` | E02 도메인 모델 + 저장소 레이어 (`core/model.ts`, `fingerprint.ts`, `invariants.ts`, `repo.ts`, `chrome/storageKv.ts`, 테스트 49건 추가) |
| 2026-09-11 | `v0.2.0` | `420f0de` | 정리 모델 "창 = 주제" 확정(기능정의서 v0.2), Extension 개발 계획서 v0.2, 앱 격리 폴더 구조(`extension/` `desktop/` `bridge/` `protocol/`), `history.md`/`README.md` 신설, E00 완료, E01 WXT 스캐폴딩(`extension/` 프로젝트, 빌드·테스트·lint 통과) |
| 2026-09-11 | `v0.1.0` | `2f2db03` | 프로젝트 정의서, 기술 리서치(`docs/research.md`), 기능정의서(`docs/functional_spec.md`), CLAUDE.md |

태그 규칙: 루트 `v0.x.y`는 문서/전체 마일스톤, 앱별로 `ext-v0.x.y`, `desktop-v0.x.y`, `bridge-v0.x.y`.
