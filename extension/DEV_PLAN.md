# Chrome Extension 개발 계획서 (마이크로 프로세스)

- 문서 버전: 0.2
- 작성일: 2026-09-11 (v0.1) / 개정: 2026-09-11 (v0.2)
- 근거: `docs/research.md` (기술 스택), `docs/functional_spec.md` v0.2 (기능 F-01..F-16, **창 = 주제 모델**)
- 범위: **Chrome Extension만** 먼저 구현한다. Desktop 앱(Tauri)과 Bridge(Native Messaging 호스트)는 이 계획의 범위 밖이며, 각자 별도 폴더·별도 계획서로 진행한다.

### 변경 이력
| 버전 | 날짜 | 내용 |
|---|---|---|
| 0.1 | 2026-09-11 | 초안 (E00~E12) |
| 0.2 | 2026-09-11 | 기능정의서 v0.2 "창 = 주제" 반영. E04를 "Topic = 창 모델"로 재정의, Tab Group 동기화를 E08 보조 스텝으로 이동, 검색 코어(E05)를 앞당기고 Popup 검색창을 정리 커맨드의 기본 UI로 격상(E06), Side Panel을 보조(E08)로 강등, E09에 행동 학습 제안 추가. 마일스톤 재편. E00 완료 처리 |

---

## 0. 운영 원칙

### 0.1 앱 격리 원칙

| 원칙 | 내용 |
|---|---|
| 폴더 격리 | `extension/`, `desktop/`, `bridge/`는 각각 독립된 프로젝트(자체 `package.json` / `Cargo.toml`, 자체 빌드·테스트·lint). 폴더 간 `import` 금지 |
| 유일한 공유물 | `protocol/` 폴더의 Bridge 메시지 JSON Schema만 공유한다. 각 앱은 이 스키마에서 **자기 언어의 타입을 각자 생성**하고, 스키마 버전(`protocol/VERSION`)을 명시한다 |
| 독립 실행 | Extension은 Desktop/Bridge가 없어도 단독으로 설치·동작·테스트 가능해야 한다 (기능정의서 §1.2) |
| 독립 릴리스 | 앱마다 별도 버전 번호·태그 (`ext-v0.x.y`, `desktop-v0.x.y`, `bridge-v0.x.y`). 루트 태그 `v0.x.y`는 문서/전체 마일스톤용 |
| 변경 영향 | 한 앱의 변경이 다른 앱의 빌드나 테스트를 깨뜨리면 안 된다. CI는 앱별로 분리 |

### 0.2 기록 원칙

| 원칙 | 내용 |
|---|---|
| **원칙 1 — history.md** | 각 개발 단계(마이크로 스텝)마다 사용자 요청·수행 내용·결정 사항·산출물을 루트 `history.md`에 **시계열로 추가**한다. 기존 항목은 수정하지 않고 아래에 덧붙인다. 매 작업 세션 종료 전 반드시 갱신 |
| **README.md** | 루트 `README.md`의 "진행 현황" 표와 "버전 히스토리"를 시계열로 유지한다. 커밋/태그가 생길 때마다 갱신 |
| 단계 완료 정의 | 스텝의 완료 기준(DoD)을 모두 만족 + `history.md` 항목 추가 + (릴리스 스텝이면) `README.md` 버전 히스토리 갱신 |

### 0.3 마이크로 프로세스 규칙

- 한 스텝은 **반나절~1일** 규모, 산출물이 눈에 보이고 검증 가능해야 한다.
- 각 스텝은 `목표 / 산출물 / 완료 기준 / 검증 / 의존` 5항목으로 정의한다.
- 스텝 순서는 앞선 스텝의 산출물만 의존한다. 뒤 스텝을 앞당기지 않는다.
- 스텝 하나가 끝날 때마다 커밋 1개 이상 (`ext: E03 tab events` 형식), 필요 시 `ext-v0.x.y` 태그.
- 막히면 스텝을 쪼개고 계획서를 갱신한다 (계획서도 버전을 올린다).

---

## 1. 폴더 구조 (목표)

```
chrome_tap_manager/
├── README.md              # 진행 현황 + 버전 히스토리 (시계열)
├── history.md             # 개발 단계 대화 기록 (시계열, 원칙 1)
├── CLAUDE.md
├── docs/                  # 기획 문서 (정의서, 리서치, 기능정의서)
├── protocol/              # Bridge 메시지 JSON Schema — 유일한 공유 계약
│   ├── VERSION
│   └── bridge.schema.json
├── extension/             # ← 이 계획서의 대상
│   ├── DEV_PLAN.md
│   ├── package.json
│   ├── wxt.config.ts
│   ├── src/
│   │   ├── entrypoints/   # background.ts, popup/, sidepanel/, options/
│   │   ├── core/          # 순수 로직 (Chrome API 의존 없음): 모델, 검색, 규칙, 커맨드 파서
│   │   ├── chrome/        # Chrome API 어댑터 (windows/tabs/groups/storage)
│   │   ├── bridge/        # native messaging 클라이언트 (인터페이스 + mock)
│   │   └── ui/            # 공용 UI 컴포넌트
│   └── tests/
├── desktop/               # Tauri 앱 (별도 계획서, 추후)
└── bridge/                # Native Messaging 프록시 호스트 (별도 계획서, 추후)
```

설계 원칙: `core/`는 Chrome API를 직접 호출하지 않는다 (Vitest로 순수 테스트). `chrome/`는 얇은 어댑터로 두고 `core/`에 주입한다.

---

## 2. 기술·모델 결정

### 2.1 정리 모델 (기능정의서 §1.5, v0.2 확정)

**창 하나 = 주제(Topic) 하나.** 일반 Chrome 창은 열리는 순간 자동으로 Topic이 되고, 정리 동작은 "이 탭을 → [주제]로 보내기" 하나다. 검색창(Popup)이 찾기·보내기·새 주제·이름 바꾸기를 모두 담당한다. Tab Group은 창 안의 보조 구조이며 EXT가 강제 생성하지 않는다. 규칙은 사용자의 반복 행동에서 학습해 제안한다.

이 결정이 계획에 미치는 영향:
- 데이터 불변 조건: `open` Topic ↔ 일반 창 1:1, 모든 열린 탭은 자기 창의 Topic에 귀속 (미분류 없음)
- Topic CRUD의 핵심은 "창 이벤트 → Topic 상태 전이"이며, Tab Group 동기화는 후순위
- 검색 코어와 Popup 검색창이 정리 UI이므로 앞당긴다

### 2.2 기술 결정 (research.md 기준)

| 항목 | 결정 |
|---|---|
| 빌드 | WXT + TypeScript (Vite) |
| UI | **Solid** (경량, 팝업/사이드패널에 적합). Desktop 앱 웹뷰와 공유 가능성이 생기면 재검토 |
| 검색 | MiniSearch + es-hangul (원문 / 자모 분해 / 초성 3중 색인) |
| 저장 | `chrome.storage.local` (영속), `chrome.storage.session` (휘발 매핑) |
| 테스트 | Vitest (core), `@webext-core/fake-browser` 또는 수동 mock (chrome 어댑터), Playwright (E2E, 후반) |
| Lint/Format | ESLint + Prettier (WXT 기본 템플릿 기준) |
| 패키지 매니저 | pnpm |
| 권한 | `tabs`, `storage`, `commands`, `contextMenus`, `tabGroups`(E08부터), `sidePanel`(E08부터), `nativeMessaging`(E10부터), `omnibox`(manifest, E07부터) |

---

## 3. 마이크로 스텝

### 마일스톤 개요

| 마일스톤 | 스텝 | 기능정의서 대응 | 릴리스 태그 |
|---|---|---|---|
| **EM1 기반** | E00~E03 | (인프라) | ext-v0.1.0 |
| **EM2 Topic = 창 코어** | E04 | F-01, F-04 | ext-v0.2.0 |
| **EM3 검색·정리 UI** | E05~E07 | F-02, F-07(EXT), F-11(Popup, Omnibox) | ext-v0.3.0 |
| **EM4 보조·자동화·세션** | E08, E09, E11 | F-03, F-09, F-10, F-11(Side Panel), F-12 | ext-v0.4.0 |
| **EM5 Bridge 준비** | E10 | F-05(EXT측), F-08(EXT측) | ext-v0.5.0 |
| **EM6 배포** | E12 | F-15(EXT측) | ext-v1.0.0 |

기능정의서의 M1(EXT 코어)은 EM1~EM3에 해당한다.

---

### E00. 저장소 골격 및 격리 구조 ✅
- **목표**: 폴더 격리 구조와 기록 파일을 만든다.
- **산출물**: `extension/`, `desktop/`, `bridge/`, `protocol/` 폴더 + 각 README 스텁, 루트 `history.md`, `README.md`, 이 계획서
- **완료 기준**: 폴더 4개 존재, `history.md`에 첫 항목, `README.md`에 진행 현황 표
- **검증**: `git status`로 구조 확인
- **의존**: 없음
- **완료**: 2026-09-11 (history #05, #06)

### E01. WXT 프로젝트 스캐폴딩
- **목표**: 빌드·로드되는 빈 Extension.
- **산출물**: `extension/package.json`, `wxt.config.ts`, `src/entrypoints/background.ts`(빈 SW), `popup/`(Hello), manifest 권한 선언(`tabs`, `storage`, `commands`, `contextMenus`), ESLint/Prettier, Vitest 설정, `.gitignore`
- **완료 기준**: `pnpm dev`로 Chrome에 로드되고 팝업이 뜬다. `pnpm build` 산출물 생성. `pnpm test` 통과(더미 1개). `pnpm lint` 통과
- **검증**: `chrome://extensions`에서 오류 0
- **의존**: E00

### E02. 도메인 모델 + 저장소 레이어
- **목표**: Topic / Tab / Subgroup / Rule / MoveLog 타입과 `storage.local` 리포지토리.
- **산출물**: `core/model.ts` (기능정의서 §6.2 구조: `Topic{id,name,isNamed,color?,status:'open'|'saved',windowId?,…}`, `Tab{topicId(필수),fingerprint,…}`; fingerprint = `sha1(normalize(url)+'\n'+normalize(title))`), `core/repo.ts` (인터페이스), `chrome/storageRepo.ts` (구현), 메모리 구현(테스트용), `schemaVersion` 마이그레이션 키
- **완료 기준**: repo CRUD 단위 테스트 통과(메모리 + storage mock). fingerprint가 NFC 정규화·trailing slash 제거 후 동일 입력에 동일 값. 불변 조건 검사 함수(`open` Topic ↔ windowId 1:1) 테스트
- **검증**: Vitest
- **의존**: E01

### E03. 창·탭 이벤트 수집기 (Service Worker)
- **목표**: 열린 창/탭 상태를 항상 최신으로 유지하는 순수 리듀서 + Chrome 어댑터.
- **산출물**: `chrome/events.ts` (`windows.onCreated/onRemoved/onFocusChanged`, `tabs.onCreated/onUpdated/onRemoved/onMoved/onAttached/onDetached/onActivated` 구독 → 정규화된 이벤트로 변환), `core/liveState.ts` (인메모리 상태 + 단조 `seq`, 이벤트 리듀서), `storage.session` 스냅샷 저장/복구, SW 기동 시 `windows.getAll({populate:true})`로 초기화. `type != normal` 창은 무시
- **완료 기준**: SW가 종료·재기동돼도 30초 내 상태 재구성. 이벤트마다 `seq` 증가. 창 20개/탭 200개에서 초기화 100 ms 이내
- **검증**: 리듀서 단위 테스트(이벤트 시퀀스 → 기대 상태) + 수동(SW 강제 종료 후 상태 조회)
- **의존**: E02
- **릴리스**: `ext-v0.1.0`

### E04. Topic = 창 모델 (F-01, F-04)
- **목표**: 창이 열리면 Topic이 생기고, 닫히면 saved로 남고, 이름을 붙일 수 있다.
- **산출물**:
  - `core/topicService.ts`: 창 생성 → Topic 생성(임시 이름), 창 닫힘 → `saved` 전환(탭 목록 보존; 임시 이름 + 탭 0개면 삭제), 탭 `onAttached/onDetached` → 탭의 `topicId` 갱신, `rename`(1~50자, 중복 검사, `isNamed=true`), `saved` Topic 삭제
  - `core/autoName.ts`: 임시 이름 규칙(탭 1개 → 사이트명, 여러 개 → 최다 host, 없으면 "새 주제 N"). 갱신 시점은 창 포커스 이탈 시(깜빡임 방지)
  - `chrome/windowMap.ts`: `windowId ↔ topicId` 맵을 `storage.session`에 유지
  - 임시 UI: Popup에 현재 창의 Topic 이름 표시 + 인라인 편집 (E06에서 검색창으로 대체)
- **완료 기준**: 기능정의서 F-01, F-04 시나리오 전부 수동 통과. 창 10개를 열고 닫고 탭을 창 간 드래그해도 불변 조건(`open` Topic ↔ 창 1:1, 모든 탭에 topicId) 위반 0 (테스트로 검증)
- **검증**: topicService 단위 테스트(이벤트 시퀀스) + 수동 체크리스트
- **의존**: E03
- **릴리스**: `ext-v0.2.0`

### E05. 검색 엔진 코어 + 커맨드 파서 (F-07 EXT측)
- **목표**: Chrome API 없이 동작하는 순수 검색·커맨드 모듈.
- **산출물**: `core/search/index.ts` (MiniSearch 래퍼; 문서 2종 — Topic 행, 탭 행), `core/search/hangul.ts` (es-hangul로 원문/자모/초성 3중 필드 생성), 랭킹(매칭 점수 + MRU 가중 + 현재 창 우선 + Topic 이름 정확 일치 최상단), `core/command.ts` (접두어 파서: 없음 / `#topic` / `>move|new|rename|open|close|save|merge` / `@saved`, 인자 자동완성 후보 생성)
- **완료 기준**: 테스트 케이스 — "ㅊㄹ"→"초록", "gh"→github.com, 영문 오타 퍼지, 혼용 "리액트 hooks", Topic 이름 정확 일치 시 최상단, `>mo 프` → `move 프로젝트A` 자동완성. 탭 1,000개 + Topic 100개 인덱스에서 쿼리 10 ms 이내(벤치 테스트)
- **검증**: Vitest + 벤치 스크립트
- **의존**: E02 (모델만)

### E06. Popup 검색창 + 정리 커맨드 + IME (F-02, F-11 Popup)
- **목표**: 찾기·보내기·새 주제·이름 바꾸기를 모두 하는 단일 검색창.
- **산출물**: `entrypoints/popup/` (Solid):
  - 입력창 + 결과 리스트(Topic 행: 색상 배지·이름·탭 수·상태 / 탭 행: favicon·제목·도메인·Topic 배지), 키보드 탐색
  - Enter: 탭 행 → `tabs.update(active)` + `windows.update(focused)`; Topic 행 → 창 전면화(saved면 복원). `Ctrl/⌘+Enter`: 소속 창 전면화
  - 커맨드: `>move <주제>` (현재/선택 탭 `tabs.move`, 대상 saved면 `windows.create`로 복원 후 이동), `>new <이름>` (`windows.create({tabId})`), `>rename <이름>`. `Shift+Enter`는 이동 후 대상 창으로 전환
  - 컨텍스트 메뉴 "→ 주제로 보내기 ▸ [목록]" / "→ 새 주제로", `commands` 단축키 "마지막 사용 주제로 보내기"
  - IME 가드(`isComposing`, `keyCode 229`), `input` 이벤트 기반 필터, NFC 정규화
  - Chrome이 백그라운드일 때의 창 전환 제약 안내 문구
- **완료 기준**: F-02 시나리오 통과(탭 보내기 200 ms 이내). Windows MS 한국어 IME + macOS 두벌식에서 조합 중 Enter 오동작 0. 팝업 오픈→입력 가능 100 ms 이내
- **검증**: 수동(양 OS) + 컴포넌트 테스트(키 이벤트 시뮬레이션) + `>move` 후 불변 조건 테스트
- **의존**: E04, E05

### E07. Omnibox 검색 (F-11 Omnibox)
- **목표**: 주소창 `t <키워드>`로 탭/Topic 전환.
- **산출물**: manifest `omnibox.keyword: "t"`, `chrome/omnibox.ts` (`onInputChanged` → 상위 6개 suggest(Topic 우선), `onInputEntered` → 전환)
- **완료 기준**: 제안에 `<match>` 하이라이트, Enter 시 해당 탭/창 활성화
- **검증**: 수동
- **의존**: E05
- **릴리스**: `ext-v0.3.0`

### E08. Side Panel 개요 + 하위 그룹 보조 (F-03, F-11 Side Panel)
- **목표**: 보조 화면으로 전체 구조를 보고 드래그로 정리하며, 창 안 Tab Group을 하위 그룹으로 인식한다.
- **산출물**: `entrypoints/sidepanel/` (Solid): Topic(창) → 하위 그룹 → 탭 트리, `saved` Topic 목록, 드래그로 탭을 다른 Topic으로 이동, Topic 이름/색상 편집. `chrome/groups.ts`: `tabGroups.on*` → `Subgroup` 저장, Topic 색상을 새 그룹 기본색으로 제안(강제 생성 없음), 하위 그룹 이름을 검색 인덱스에 추가. 권한 `tabGroups`, `sidePanel` 추가
- **완료 기준**: F-03 시나리오 통과. EXT가 사용자 동의 없이 Tab Group을 만들거나 바꾸는 경우 0
- **검증**: 수동 체크리스트
- **의존**: E06

### E09. 규칙: 행동 학습 제안 + 수동 규칙 (F-10)
- **목표**: 반복 이동을 학습해 한 번만 묻고, 이후 자동으로 보낸다.
- **산출물**: `core/moveLog.ts` (최근 100건), `core/ruleSuggest.ts` (같은 host/path 접두어 → 같은 Topic 2회 시 제안 생성), 제안 배너 UI(Popup/Side Panel, 예/아니오/다시 묻지 않기), `core/rules.ts` (host/prefix/regex 평가, 우선순위, `enabled`), `tabs.onUpdated` URL 확정 시 평가 → `tabs.move`(현재 창이 이미 그 Topic이면 무시, 대상 saved면 배지만), 자동 이동 후 5초 "되돌리기" 토스트(3회 되돌리면 비활성화 제안), Side Panel/Options 수동 규칙 편집
- **완료 기준**: 사용자 직접 이동이 규칙보다 항상 우선. 규칙 100개 × 탭 이벤트 평가 1 ms 이내. 제안은 동일 패턴에 대해 1회만
- **검증**: Vitest(제안 생성·평가·되돌리기 상태 머신) + 수동
- **의존**: E06

### E10. Bridge 클라이언트 인터페이스 (F-05, F-08 EXT측)
- **목표**: Desktop/Bridge 없이도 테스트 가능한 native messaging 클라이언트.
- **산출물**: `protocol/bridge.schema.json` v0.1 (기능정의서 §6.3: `hello`/`snapshot_request`/`snapshot`/`delta`/`focus`/`focus_result`/`move`/`new_topic`/`rename`/`open`/`close`/`topics_update`/`ping`/`pong`), `bridge/client.ts` (`connectNative` 포트 관리, 재연결 백오프, 스냅샷 200개 페이지 분할, `seq` 델타), `bridge/mockHost.ts` (테스트용 인메모리 호스트), 연결 상태를 Popup/Side Panel에 배지로 표시. 권한 `nativeMessaging` 추가
- **완료 기준**: mock 호스트로 전체 메시지 왕복 테스트 통과. 실제 호스트 부재 시 에러 없이 "미연결" 상태로 유지되고 나머지 기능 정상
- **검증**: Vitest (mock) — 실제 호스트 연동 테스트는 `bridge/` 프로젝트 몫
- **의존**: E04, E06, `protocol/`
- **주의**: 이 스텝은 `protocol/` 스키마만 추가할 뿐 `bridge/`, `desktop/` 폴더의 코드를 건드리지 않는다
- **릴리스**: `ext-v0.5.0`

### E11. 세션 복원 + Topic 통째로 열기/닫기 (F-09, F-12 EXT측)
- **목표**: Chrome 재시작 후 Topic이 복원되고, 검색창에서 Topic을 통째로 열고 닫는다.
- **산출물**: `core/sessionMatch.ts` (`onStartup`에서 새 창들의 탭 지문 집합과 saved/직전 open Topic을 Jaccard ≥ 0.5로 대조 → 매핑 복구, 이름·색상·하위 그룹 복원, 실패 창은 새 Unnamed Topic), 커맨드 `>open` (saved → `windows.create` + `tabs.create`), `>close` (창 닫기 → saved), `>save`, `>merge`, 탭 닫힘 시 저장 탭 보존 옵션(기본 OFF), JSON 내보내기/가져오기(Options)
- **완료 기준**: 재시작 후 이름 지정 Topic 복원율 100% (동일 URL 집합 기준). `>open`/`>close` 왕복 후 탭 목록 손실 0. 충돌 시 `updated_at` last-writer-wins
- **검증**: 대조 로직 단위 테스트 + 수동(재시작 시나리오)
- **의존**: E06, E08
- **릴리스**: `ext-v0.4.0`

### E12. 옵션 페이지·패키징·스토어 준비 (F-15 EXT측)
- **목표**: 배포 가능한 zip.
- **산출물**: `entrypoints/options/` (단축키 안내, 빈 창 닫힘 시 Topic 보존, 탭 닫힘 시 저장 탭 보존, 규칙 자동 복원, 데이터 초기화), manifest `key` 고정(확장 ID 고정 → `allowed_origins`용), 아이콘 세트, 온보딩(창 = 주제 설명, Chrome 창 이름과 별개임을 안내), 스토어 설명/스크린샷, `pnpm zip`
- **완료 기준**: 고정 ID로 로드, zip이 스토어 검증 통과, 권한 최소화 검토 완료
- **검증**: 수동
- **의존**: E09, E10, E11
- **릴리스**: `ext-v1.0.0`

---

## 4. 스텝별 체크리스트 (진행 현황)

| 스텝 | 내용 | 상태 | 시작 | 완료 | 커밋/태그 | history.md 항목 |
|---|---|---|---|---|---|---|
| E00 | 저장소 골격 및 격리 구조 | ✅ 완료 | 2026-09-11 | 2026-09-11 | (미커밋) | #05, #06 |
| E01 | WXT 스캐폴딩 | ✅ 완료 (Chrome 수동 로드 확인은 사용자 검증 대기) | 2026-09-11 | 2026-09-11 | (미커밋) | #07 |
| E02 | 도메인 모델 + 저장소 | ⬜ 대기 | | | | |
| E03 | 창·탭 이벤트 수집기 | ⬜ 대기 | | | | |
| E04 | Topic = 창 모델 | ⬜ 대기 | | | | |
| E05 | 검색 엔진 코어 + 커맨드 파서 | ⬜ 대기 | | | | |
| E06 | Popup 검색창 + 정리 커맨드 + IME | ⬜ 대기 | | | | |
| E07 | Omnibox | ⬜ 대기 | | | | |
| E08 | Side Panel 개요 + 하위 그룹 | ⬜ 대기 | | | | |
| E09 | 규칙: 행동 학습 제안 + 수동 규칙 | ⬜ 대기 | | | | |
| E10 | Bridge 클라이언트 인터페이스 | ⬜ 대기 | | | | |
| E11 | 세션 복원 + Topic 열기/닫기 | ⬜ 대기 | | | | |
| E12 | 옵션 · 패키징 · 스토어 | ⬜ 대기 | | | | |

이 표는 스텝이 바뀔 때마다 갱신한다. 루트 `README.md`의 진행 현황과 일치해야 한다.

---

## 5. 리스크 및 대응

| 리스크 | 대응 |
|---|---|
| SW 30초 종료로 인메모리 상태 유실 | E03에서 `storage.session` 스냅샷 + 기동 시 `windows.getAll` 재구성. E10 이후엔 native port가 keep-alive |
| `windows.update({focused})`가 Chrome 백그라운드일 때 실패 | EXT 범위에서는 제약을 UI에 안내(E06). OS 레벨 전면화는 Desktop 몫 |
| 창 닫힘과 "마지막 탭을 다른 창으로 이동"의 구분 | E04에서 `onDetached` 후 `onRemoved` 순서를 리듀서 테스트로 고정 |
| 임시 이름이 자주 바뀌어 검색 결과가 흔들림 | 갱신을 창 포커스 이탈 시로 제한, 이름 지정 시 갱신 중단 (E04) |
| 사용자가 Chrome 기본 "창 이름 지정"을 쓰면 EXT 이름과 불일치 | API로 읽을 수 없음 → 온보딩에서 안내(E12), Topic 이름은 EXT가 관리 |
| 한글 IME 이중 Enter | E06 가드 + 양 OS 수동 테스트를 완료 기준에 명시 |
| 학습 제안이 귀찮게 느껴짐 | 동일 패턴 1회만, "다시 묻지 않기" 제공, 되돌리기 3회면 비활성화 제안 (E09) |
| 확장 ID 변경 시 Bridge 인증 깨짐 | E12에서 manifest `key` 고정, `protocol/`에 ID 기록 |
| WXT 메이저 업데이트 | `package.json` 버전 고정, 업그레이드는 별도 스텝 |

---

## 6. 후속 계획서

- `desktop/DEV_PLAN.md` — Tauri 앱 (EM5 완료 후 착수). 런처의 커맨드 세트는 E05 `core/command.ts`와 동일하게 맞춘다
- `bridge/DEV_PLAN.md` — Native Messaging 프록시 호스트 (`protocol/` v0.1 확정 후, EM5와 병행 가능)
