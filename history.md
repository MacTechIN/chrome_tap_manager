# history.md — 개발 단계 대화 기록 (시계열)

> **원칙 1**: 각 개발 단계마다 사용자 요청 · 수행 내용 · 결정 사항 · 산출물을 이 파일에 시계열로 **추가**한다. 기존 항목은 수정하지 않는다. 매 작업 세션 종료 전 갱신한다.
>
> 형식: `## #NN · YYYY-MM-DD · 단계명` → 요청 / 수행 / 결정 / 산출물 / 커밋

---

## #01 · 2026-09-11 · 저장소 초기 분석 (/init)

- **요청**: 코드베이스를 분석해 CLAUDE.md 생성
- **수행**: 저장소에 `docs/project_definition.md` 1개만 존재함을 확인. 코드·빌드 도구 없음. 프로젝트 의도를 영문으로 요약한 CLAUDE.md 작성
- **결정**: 빌드/테스트 명령은 코드가 생기면 추가하기로 함 (추측 금지)
- **산출물**: `CLAUDE.md`
- **비고**: 사용자 홈에 Codex / Gemini CLI 설정이 있어 `/import` 안내

## #02 · 2026-09-11 · 기술 스택 리서치 (멀티에이전트)

- **요청**: 정의서를 분석해 필요한 기술 스택을 GitHub · Hugging Face · 웹 검색으로 (멀티에이전트) 조사, `research.md` 생성
- **수행**: 리서치 에이전트 4개 병렬 실행 — ① Chrome Extension 스택 ② 데스크톱 트레이/런처 스택 ③ Extension↔Desktop 연동 ④ 검색/AI(한글, 임베딩 모델). 결과를 통합해 문서화
- **결정** (핵심):
  - Extension: MV3 + WXT + TypeScript
  - Desktop: Tauri v2 (Rust), 트레이 상주, 글로벌 단축키, macOS NSPanel
  - Bridge: Native Messaging + 프록시 호스트 (socket / named pipe), KeePassXC·Bitwarden 패턴
  - 창 전면화: Extension이 탭/창 활성화 + Desktop이 OS 레벨 포커스 (`windows.update({focused})` 단독 불가)
  - 검색: MiniSearch + es-hangul (EXT) / nucleo (Desktop). 옵션 시맨틱: multilingual-e5-small int8
  - 배제: CDP `--remote-debugging-port` (Chrome 136+ 기본 프로필 차단), SNSS 파일 파싱
- **산출물**: `docs/research.md`

## #03 · 2026-09-11 · 앱 기능정의서 작성

- **요청**: research.md 완료 후 앱 기능정의서를 정리·저장
- **수행**: 정의서 + 리서치를 바탕으로 기능 F-01..F-16 (우선순위 P0~P2), 비기능 요구, 데이터 모델(SQLite), Bridge 메시지 초안, 마일스톤 M1..M4, 미결 사항 정리
- **결정**: Desktop SQLite를 source of truth로, Extension은 `storage.local` 캐시. 탭 identity는 URL+title 지문
- **산출물**: `docs/functional_spec.md`. CLAUDE.md에 문서 안내 및 아키텍처 요약 추가

## #04 · 2026-09-11 · git 초기화 · v0.1.0 커밋 · 푸시

- **요청**: 기능정의서 완료 후 git init, 버전 설명을 붙여 커밋·푸시
- **수행**: `git init -b main`, 원격 `origin` = https://github.com/MacTechIN/chrome_tap_manager.git, 저장소 로컬 git 사용자 설정(MacTechIN / wooriszhome@gmail.com), 커밋 `2f2db03`, annotated 태그 `v0.1.0`, `main`·태그 푸시
- **결정**: 전역 git 설정은 건드리지 않고 저장소 로컬 설정만 사용
- **산출물**: 커밋 `2f2db03` "v0.1.0: 프로젝트 정의서, 기술 리서치, 기능정의서 초안", 태그 `v0.1.0`

## #05 · 2026-09-11 · Extension 개발 계획서 · 격리 구조 · 기록 원칙 (E00)

- **요청**: research 기술 방향으로 별도 폴더에 Chrome Extension을 먼저 구현하기 위한 마이크로 프로세스 개발 계획서 작성. 모든 앱은 별도로 서로 영향을 주지 않도록 진행. 각 개발 단계의 대화 내용을 `history.md`에 시계열로 계속 갱신(원칙 1). `README.md`에 진행 현황과 버전 관리 히스토리를 시계열로 보관
- **수행**:
  - 앱 격리 구조 생성: `extension/`, `desktop/`, `bridge/`, `protocol/` (각 README 스텁, `protocol/VERSION` = 0.0.0)
  - `extension/DEV_PLAN.md` 작성: 운영 원칙(격리·기록·마이크로 프로세스), 폴더 구조, 기술 결정, 마이크로 스텝 E00~E12 (목표/산출물/완료 기준/검증/의존), 마일스톤 EM1~EM6, 체크리스트, 리스크
  - `history.md` 신설 (#01~#05 소급 기록), `README.md` 신설 (진행 현황 + 버전 히스토리)
  - CLAUDE.md에 격리 원칙·기록 원칙 추가
- **결정**:
  - 앱 간 공유물은 `protocol/` JSON Schema만. 폴더 간 import 금지. 앱별 태그 `ext-v*`, `desktop-v*`, `bridge-v*`
  - Extension UI 프레임워크: Solid (잠정)
  - 스텝 완료 정의 = DoD 충족 + history.md 항목 + (릴리스 시) README 버전 히스토리
- **산출물**: `extension/DEV_PLAN.md`, `history.md`, `README.md`, `protocol/README.md`, `protocol/VERSION`, `desktop/README.md`, `bridge/README.md`, `CLAUDE.md` 갱신
- **커밋**: `420f0de` (태그 `v0.2.0`, #05~#07 일괄)

## #06 · 2026-09-11 · 정리 모델 확정: "창 하나 = 주제 하나" (기능정의서 v0.2, 계획서 v0.2)

- **요청**: (1) 사용자가 탭을 정리하는 방식으로 이용자 차원에서 가장 간단 명료한 방법을 추천 → (2) 추천 방향으로 확정하고 기능정의서와 계획서 수정
- **수행**:
  - 4가지 방식(수동 태깅 / URL 규칙 선설정 / AI 클러스터링 / 창 = 주제)을 사용자 부담·명료성·창 전면화 궁합으로 비교해 "창 = 주제" 추천, 사용자 확정
  - `docs/functional_spec.md` v0.2: §1.5 정리 모델 신설, 용어 재정의(Topic = 일반 창 1:1, Unassigned 폐기 → Unnamed Topic, Sub-group 도입), F-01(창 자동 생성·임시 이름·rename), F-02(검색창 커맨드 `>move`/`>new`가 기본 경로), F-03(Tab Group을 P1 보조로 강등, 자동 동기화 폐기), F-04(창↔Topic 매핑·saved 전환), F-09(`>open`/`>close`/`>save`/`>merge`), F-10(2회 반복 이동 시 규칙 제안, 되돌리기), F-11(Popup P0, Side Panel 보조), F-12(Jaccard 대조 복원), F-14(창 분리 제안), 데이터 모델(`topic.status`, `is_named`, `subgroup`, `move_log`), Bridge 메시지(`move`/`new_topic`/`rename`/`open`/`close`), 릴리스 M1~M3 재편, 미결 3번 종결
  - `extension/DEV_PLAN.md` v0.2: E04 "Topic = 창 모델", E05 검색 코어+커맨드 파서 앞당김, E06 Popup 검색창을 정리 커맨드 기본 UI로, E07 Omnibox, E08 Side Panel+하위 그룹(보조), E09 행동 학습 제안, E11 세션 복원+Topic 열기/닫기. 마일스톤 EM1~EM6 재편. E00 완료 처리
- **결정**:
  - 창 = 주제 1:1. 모든 일반 창은 자동 Topic, 미분류 탭 없음, 창 닫히면 saved Topic
  - 정리 동작은 "탭을 주제로 보내기" 하나, 검색창이 정리 도구
  - Tab Group은 보조 구조, EXT가 강제 생성하지 않음
  - 규칙은 행동 학습 후 1회 제안, 사용자 직접 이동이 항상 우선
- **산출물**: `docs/functional_spec.md` v0.2, `extension/DEV_PLAN.md` v0.2, `README.md`·`CLAUDE.md` 갱신
- **커밋**: `420f0de` (태그 `v0.2.0`, #05~#07 일괄)

## #07 · 2026-09-11 · E01 WXT 프로젝트 스캐폴딩

- **요청**: "다음" (계획서의 다음 스텝 E01 진행)
- **수행**:
  - 환경: Node 24.14.1, pnpm 미설치 → `npm i -g pnpm` (12.3.4). corepack은 권한 오류로 사용 안 함
  - `extension/` 생성: `package.json`(scripts: dev/build/zip/test/typecheck/lint/format, postinstall `wxt prepare`), `wxt.config.ts`(srcDir `src`, Solid 모듈, 권한 `tabs`/`storage`/`commands`/`contextMenus`, `_execute_action` 단축키 Ctrl+Shift+Space / mac Alt+Space), `tsconfig.json`(`.wxt/tsconfig.json` 상속, strict), `vitest.config.ts`(WxtVitest 플러그인), `eslint.config.js`(typescript-eslint + prettier), `.prettierrc`, `.prettierignore`, `.gitignore`
  - 소스: `src/entrypoints/background.ts`(빈 SW), `src/entrypoints/popup/`(Solid, 일반 창/탭 수 표시), `src/core/summary.ts`(순수 함수 예시), `tests/summary.test.ts`(순수 함수 2건 + fake-browser storage 1건)
  - 검증: `pnpm build` 통과(15 KB, manifest 권한 확인), `pnpm test` 3/3 통과, `pnpm typecheck` 통과, `pnpm lint` 통과
  - 문제 해결: WXT 0.21은 `wxt/testing`이 아니라 `wxt/testing/vitest-plugin`, `wxt/testing/fake-browser`로 export 분리 → import 수정. Markdown은 Prettier 검사 제외
- **결정**:
  - 고정 버전: wxt 0.21.4, @wxt-dev/module-solid 1.1.4, solid-js 1.9.15, vitest 5.0.0, typescript 5.9.3 (TS 7.0은 툴체인 호환 검증 전이라 보류), eslint 10.10.0, typescript-eslint 8.70.0, prettier 3.9.6
  - `#imports`로 WXT 자동 import 사용
- **산출물**: `extension/` 프로젝트 일체, `extension/README.md`(명령어 표)
- **미검증**: `pnpm dev`로 실제 Chrome에 로드하여 팝업이 뜨는지는 사용자 확인 필요 (`.output/chrome-mv3/` 수동 로드 가능)
- **커밋**: `420f0de` (태그 `v0.2.0`, #05~#07 일괄)

## #08 · 2026-09-11 · v0.2.0 커밋

- **요청**: "카밋"
- **수행**: #05~#07 작업분(문서 v0.2, 격리 구조, E00~E01)을 단일 커밋 `420f0de`로 커밋하고 annotated 태그 `v0.2.0` 생성. `.gitattributes`(LF 고정) 추가. README/history/계획서의 "(미커밋)" 표기를 커밋 해시로 갱신하는 후속 커밋 1건
- **결정**: 루트 태그 `v0.2.0`은 문서 마일스톤(기능정의서 v0.2). Extension 자체 태그 `ext-v0.1.0`은 EM1(E03) 완료 시 부여
- **산출물**: 커밋 `420f0de`, 태그 `v0.2.0`
- **푸시**: 미푸시 (사용자 지시 대기)

## #09 · 2026-09-11 · v0.2.0 푸시 · 테스트 재확인

- **요청**: "푸쉬", "테스트 ?"
- **수행**: `git push origin main` (`2f2db03..9688761`), `git push origin v0.2.0`. 푸시 후 `pnpm test` 재실행 → 3/3 통과
- **테스트 현황**: 자동 테스트는 `tests/summary.test.ts` 3건(순수 함수 2, fake-browser storage 1). Chrome 실기기 로드(팝업 표시)는 사용자 수동 검증 항목으로 남음
- **산출물**: 원격 `main` = `9688761`, 태그 `v0.2.0`

## #10 · 2026-09-11 · E02 도메인 모델 + 저장소 레이어

- **요청**: "다음" (E02 진행)
- **수행**:
  - `src/core/model.ts`: `Topic`(status open/saved, windowId, isNamed, color), `Tab`(topicId 필수, fingerprint, chromeTabId, subgroupId), `Subgroup`, `Rule`(kind/source/enabled/undoCount), `MoveLogEntry`, `Store`, `SCHEMA_VERSION=1`, `MOVE_LOG_LIMIT=100`, `topicNameKey()`
  - `src/core/fingerprint.ts`: `normalizeUrl`(NFC, hash 제거, 기본 포트 제거, 루트 제외 trailing slash 제거), `normalizeTitle`(NFC, 공백 압축), `fingerprint()` = FNV-1a 64bit hex
  - `src/core/invariants.ts`: `checkInvariants()` 15종 위반 코드 (open Topic↔창 1:1, saved에 windowId 없음, named 이름 중복 금지, 탭 orphan/chromeTabId 정합, subgroup·rule orphan), `assertInvariants()`
  - `src/core/repo.ts`: `KeyValueStore` 인터페이스 + `MemoryKV`; `Repo`(init/마이그레이션 훅/snapshot/replaceAll/clear, Topic·Tab·Subgroup·Rule·MoveLog CRUD, `findTopicByWindow`, `findTabByChromeId`, deleteTopic cascade, deleteSubgroup 시 탭 detach, moveLog 100건 캡). 컬렉션별 키(`ctm:topics` 등)로 부분 쓰기
  - `src/chrome/storageKv.ts`: `chrome.storage.local/session` 어댑터 (`#imports` browser)
  - 테스트 3파일 49건 추가 (fingerprint 11, invariants 10, repo 14×2 백엔드). 총 52/52 통과. typecheck·lint·build 통과
  - 수정: `chrome://extensions/`는 유효 URL이라 루트 슬래시 유지(테스트 기대값 수정), 테스트 탭 chromeTabId 중복 제거, repo.ts 콤마 표현식을 if 블록으로(ESLint no-unused-expressions)
- **결정**:
  - fingerprint는 계획서의 sha1 대신 **동기 FNV-1a 64bit** (E03 리듀서를 동기로 유지하기 위함, 충돌 위험 무시 가능)
  - 저장 구조: 컬렉션당 1키, 메모리 캐시 + write-through. 하나의 `Repo` 클래스에 두 백엔드(Memory / chrome.storage) 주입
  - `deleteTopic`은 tabs/subgroups/rules/moveLog로 cascade (saved Topic 삭제 시 저장 탭 목록 함께 삭제, 기능정의서 F-01)
  - `now`/`newId`를 주입 가능하게 하여 서비스 레이어(E04) 테스트 결정성 확보
- **산출물**: 위 소스 5개 + 테스트 3개
- **커밋**: 미커밋 (사용자 지시 대기)

## #11 · 2026-09-12 · Windows Chrome 실기기 로드 확인 (E01 미검증 항목 해소)

- **요청**: Windows에 설치·테스트 방법 안내 → "윈도우 상황 확인" → "로드했어 지금 상황 알려줘" → 포트 3000 서버 강제 종료 → 스크린샷으로 로드 결과 공유
- **수행**:
  - 환경 점검: Chrome 152.0.7977.84 (Program Files), 프로필 Default/Profile 1/Profile 2. "조직에서 관리하는 브라우저" 표시는 레지스트리 정책 `LocalNetworkAccessAllowedForUrls`(SharePoint) 때문이며 확장 차단 정책 없음 확인 (레지스트리 + Profile 2 클라우드 정책 캐시)
  - `pnpm dev`가 2회 실행되어 포트 3000(22:55)·3001(00:24) 서버가 중복 → 사용자 요청으로 3000(PID 41628) 강제 종료. WXT 0.21은 브라우저 자동 실행 없이 "Load .output\chrome-mv3-dev manually" 안내만 함 (정상)
  - 1차 로드 시도는 카드 미표시(폴더 선택 오류 추정) → 정확한 폴더 경로 안내 후 재로드 성공
  - 교차 검증: 확장 ID `ijpicpomjkilcfefmafppjlaphagmhbf`가 Default 프로필 Preferences/Secure Preferences에 기록, Chrome 프로세스가 dev 서버 :3001에 Established 연결, 서비스 워커 활성, 오류 버튼 없음
- **결정**: 개발 중 로드 폴더는 `.output/chrome-mv3-dev` (dev 서버 필요, Alt+R 리로드). 서버 종료 시에는 `pnpm build` 후 `.output/chrome-mv3`
- **산출물**: E01 완료 기준의 미검증 항목("Chrome에 로드되고 팝업이 뜬다") 해소. 계획서 체크리스트 갱신
- **커밋**: 미커밋

## #12 · 2026-09-12 · E03 창·탭 이벤트 수집기

- **요청**: "창 정리는 어떻게 해?" (현재 미구현·향후 UX 설명) → "다음" (E03 진행)
- **수행**:
  - `src/core/liveState.ts`: `LiveState{seq, windows, tabs, focusedWindowId}`와 11종 `LiveEvent`(init, window.created/removed/focused, tab.created/updated/removed/moved/attached/detached/activated)를 처리하는 순수 리듀서 `reduce()`. 모든 이벤트에서 `seq` 증가(무시된 이벤트 포함), 창 내 탭 순서·index 재번호, 미추적 창 이벤트 무시, 이전 상태 불변. 셀렉터 `windowList/tabsOf/activeTabOf/counts`
  - `src/core/liveTracker.ts`: `LiveTracker` — 동기 구독 → `storage.session`에서 `seq` 복원 → 스냅샷(`windows.getAll`)으로 재구성 → 로딩 중 도착한 이벤트 큐 재생, 250ms 디바운스 저장, `onChange` 리스너, `resync()`, `flush()`, `stop()`
  - `src/chrome/events.ts`: Chrome 이벤트 → LiveEvent 정규화 어댑터(`subscribeChromeEvents`, `loadInitialState`, `toLiveTab`), type≠normal 창 필터, groupId -1 → undefined, WINDOW_ID_NONE → undefined
  - `src/core/messages.ts` + `background.ts`: `live.get`/`live.resync` 런타임 메시지. 팝업(`App.tsx`)이 창 목록·탭 수·seq·SW 시작 시각 표시
  - `core/summary.ts`와 그 테스트(E01 예시) 제거
  - 테스트 37건 추가(liveState 19, liveTracker 8, chrome/events 10) → 총 86/86. typecheck·lint·build 통과. 성능 테스트: 창 20/탭 200 init < 100ms
  - 문제 해결: fake-browser 2.0.1이 `tabs.onMoved/onAttached/onDetached` 미구현 → 테스트에서 stub 이벤트 주입; fake-browser 창에 `type` 없음 → `isNormalWindow`가 undefined를 normal로 간주; 트래커 테스트가 `kv.get` 틱 이전에 스냅샷 release 시도 → 틱 대기 추가
- **결정**:
  - `seq`는 무시된 이벤트에서도 증가 (커서 단조성 우선, E10 델타 정렬용)
  - SW 기동 시 세션 저장값은 `seq`만 신뢰하고 상태는 항상 `windows.getAll`로 재구성 (SW 사망 중 놓친 이벤트 대비)
  - detach 시 탭은 `tabs`에 남기고 창 목록에서만 제거, attach에서 windowId 갱신 (Chrome 이벤트 순서 detached→attached→(old window) removed 대응)
- **산출물**: 위 소스 5개(신규 4, 수정 background/App/style), 테스트 3개
- **미검증**: 실기기에서 SW 강제 종료 후 30초 내 상태 재구성과 seq 연속성은 사용자 수동 확인 대기 (팝업의 seq가 리로드 후에도 증가만 하는지)
- **커밋**: 미커밋. EM1(E00~E03) 완료이므로 커밋 시 `ext-v0.1.0` 태그 부여 예정

## #13 · 2026-09-12 · E03 실기기 확인 (팝업 라이브 상태)

- **요청**: "Alt+R 해도 반응 없음" → 단축키 역할 설명 → "아이콘 클릭하면 팝업 뜬다 seq 보임" + 스크린샷
- **확인**: 팝업에 일반 창 3개 · 탭 48개 · seq 6 · 창별 탭 수/활성 탭 제목 · SW 시작 시각 표시. E03 실기기 동작 확인
- **발견**: `Alt+R`(확장 리로드) 후 seq가 작은 값으로 시작 — Chrome이 확장 리로드/업데이트/브라우저 재시작 시 `storage.session`을 비우기 때문. seq 연속성은 SW 유휴 종료→재기동 경우에만 보장됨. 설계상 허용 (E10 Bridge는 재연결 시 전체 재동기화)
- **안내 수정**: `Alt+R`은 리로드 전용, 팝업은 툴바 아이콘 클릭 또는 `Ctrl+Shift+Space`
- **커밋**: 미커밋
