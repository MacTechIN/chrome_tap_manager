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
- **커밋**: `de8396b` (태그 `ext-v0.1.0`, #10~#13 일괄)

## #11 · 2026-09-12 · Windows Chrome 실기기 로드 확인 (E01 미검증 항목 해소)

- **요청**: Windows에 설치·테스트 방법 안내 → "윈도우 상황 확인" → "로드했어 지금 상황 알려줘" → 포트 3000 서버 강제 종료 → 스크린샷으로 로드 결과 공유
- **수행**:
  - 환경 점검: Chrome 152.0.7977.84 (Program Files), 프로필 Default/Profile 1/Profile 2. "조직에서 관리하는 브라우저" 표시는 레지스트리 정책 `LocalNetworkAccessAllowedForUrls`(SharePoint) 때문이며 확장 차단 정책 없음 확인 (레지스트리 + Profile 2 클라우드 정책 캐시)
  - `pnpm dev`가 2회 실행되어 포트 3000(22:55)·3001(00:24) 서버가 중복 → 사용자 요청으로 3000(PID 41628) 강제 종료. WXT 0.21은 브라우저 자동 실행 없이 "Load .output\chrome-mv3-dev manually" 안내만 함 (정상)
  - 1차 로드 시도는 카드 미표시(폴더 선택 오류 추정) → 정확한 폴더 경로 안내 후 재로드 성공
  - 교차 검증: 확장 ID `ijpicpomjkilcfefmafppjlaphagmhbf`가 Default 프로필 Preferences/Secure Preferences에 기록, Chrome 프로세스가 dev 서버 :3001에 Established 연결, 서비스 워커 활성, 오류 버튼 없음
- **결정**: 개발 중 로드 폴더는 `.output/chrome-mv3-dev` (dev 서버 필요, Alt+R 리로드). 서버 종료 시에는 `pnpm build` 후 `.output/chrome-mv3`
- **산출물**: E01 완료 기준의 미검증 항목("Chrome에 로드되고 팝업이 뜬다") 해소. 계획서 체크리스트 갱신
- **커밋**: `de8396b` (태그 `ext-v0.1.0`, #10~#13 일괄)

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
- **커밋**: `de8396b` (태그 `ext-v0.1.0`, #10~#13 일괄)

## #13 · 2026-09-12 · E03 실기기 확인 (팝업 라이브 상태)

- **요청**: "Alt+R 해도 반응 없음" → 단축키 역할 설명 → "아이콘 클릭하면 팝업 뜬다 seq 보임" + 스크린샷
- **확인**: 팝업에 일반 창 3개 · 탭 48개 · seq 6 · 창별 탭 수/활성 탭 제목 · SW 시작 시각 표시. E03 실기기 동작 확인
- **발견**: `Alt+R`(확장 리로드) 후 seq가 작은 값으로 시작 — Chrome이 확장 리로드/업데이트/브라우저 재시작 시 `storage.session`을 비우기 때문. seq 연속성은 SW 유휴 종료→재기동 경우에만 보장됨. 설계상 허용 (E10 Bridge는 재연결 시 전체 재동기화)
- **안내 수정**: `Alt+R`은 리로드 전용, 팝업은 툴바 아이콘 클릭 또는 `Ctrl+Shift+Space`
- **커밋**: `de8396b` (태그 `ext-v0.1.0`, #10~#13 일괄)

## #14 · 2026-09-12 · E04 Topic = 창 모델 (F-01, F-04)

- **요청**: "커밋"(ext-v0.1.0) → "다음" (E04 진행)
- **수행**:
  - `src/core/autoName.ts`: `siteName`(www 제거 host, 비http는 `scheme://host`), `nameFromTabs`(1개→사이트, 여러 개→최다 host, 없으면 첫 제목), `nextUnnamed`("새 주제 N"), `autoName`
  - `src/core/topicService.ts`: LiveEvent+LiveState를 받아 Repo를 갱신. window.created→Topic(open, 임시 이름), window.removed→saved(탭 목록 보존; 이름 미지정+탭 0개면 삭제), tab.created/updated/removed/moved/attached/activated→Tab 행(topicId, fingerprint, index, lastActiveAt), window.focused→직전 창의 임시 이름 재계산. `reconcile()`(init/resync), `rename()`(1~50자, NFC, 이름 지정 Topic 간 대소문자 무시 중복 금지), `deleteSaved()`, `listTopics()`(open 최근순→saved). `TopicError` 코드 5종
  - `Repo.batch()`: 이벤트 1건당 컬렉션별 쓰기 1회로 합침
  - `background.ts`: Repo(local) + 세션 마커(`ctm:session`, storage.session) → `freshSession` 판정 → TopicService. Chrome 리스너는 SW 첫 턴에 동기 등록, 서비스 준비 전 이벤트는 버퍼 후 순서대로 적용. 메시지 `topics.list`/`topic.rename`/`topic.deleteSaved` 추가
  - 팝업: 열린 주제(현재 창 강조)/저장된 주제 목록, 이름 클릭 → 인라인 변경(IME Enter 가드, Esc 취소), 오류 표시
  - 테스트 28건 추가(autoName 8, topicService 20 — init/reconcile 3, 창 생명주기 5, 탭 생명주기 7, rename/delete/list 4, 200이벤트 랜덤 churn 불변 조건 1) → 총 114/114. typecheck·lint·build 통과
  - 수정: 테스트 seed 콜백이 이전 harness를 참조하던 버그
- **결정**:
  - 계획서의 `chrome/windowMap.ts`(storage.session 매핑) 대신 **Topic.windowId(storage.local) + 세션 마커**로 대체. 마커가 없으면(Chrome 재시작·확장 리로드) 저장된 open Topic을 전부 saved로 전환 — Chrome이 세션마다 windowId를 재사용하므로 오매칭 방지. 스마트 재매칭은 E11
  - `tab.removed(isWindowClosing=true)`는 행을 지우지 않고 닫힘 표시만 → 이어지는 `window.removed`에서 saved 목록 보존
  - 임시 이름 갱신 시점: 탭 1개 이하일 때 즉시, 그 외에는 창 포커스 이탈 시 (깜빡임 방지)
  - 사용자가 직접 닫은 탭(`isWindowClosing=false`)은 행 삭제 (저장 탭 보존 옵션은 E11)
- **산출물**: 소스 신규 2(autoName, topicService), 수정 5(repo, messages, background, App, style), 테스트 2
- **미검증**: 실기기에서 F-01/F-04 시나리오(창 열기→주제 생성, 이름 변경, 창 닫기→저장된 주제) 사용자 확인 대기
- **커밋**: `9404ba5` (태그 `ext-v0.2.0`, #14~#16 일괄)

## #15 · 2026-09-12 · E05 검색 엔진 코어 + 커맨드 파서 (F-07 EXT측)

- **요청**: "다음" (E05 진행)
- **수행**:
  - 의존성 추가: `minisearch` 7.2.0, `es-hangul` 2.4.0 (고정 버전)
  - `src/core/search/hangul.ts`: `normalizeText`(NFC·소문자·공백 압축), `tokenize`(공백·구두점·기호 분리, 모든 문자 체계의 글자 유지), 토큰 단위 `tokenToJamo`/`tokenToChoseong`(es-hangul `getChoseong`이 비한글을 버리므로 문자별 처리), `variants()` → raw/jamo/cho 3중 문자열, `isChoseongQuery`, `queryToJamo`
  - `src/core/search/fuzzy.ts`: fzf형 부분열 점수(`subsequenceScore`: 접두·단어 시작·연속 보너스, 간격 감점), `prepareQuery`(검색당 1회) + `matchPrepared`(색인 시 압축된 변형 대상), `matchVariants` 편의 함수
  - `src/core/search/index.ts`: `SearchIndex` — Topic/Tab 문서 2종, MiniSearch 필드 12개(raw/jamo/cho × name/title/topic + host/path/desc), 검색 = raw 토큰(prefix + 4자 이상 오타 허용 0.2) ∪ 초성 필드 ∪ 자모 필드 ∪ 퍼지 패스(name/host), 부스트(주제 이름 정확 일치 +100, 주제 종류 +0.3, open +0.2, 현재 창 +0.5, 최근성 +0.5/(1+시간)), 범위 all/saved/topic, 빈 쿼리는 최근순, `upsert/remove/replaceAll`, `splitUrl`
  - `src/core/command.ts`: `parseInput`(`#topic text` / `@saved text` / `>cmd arg` / 검색), 커맨드 7종 메타(`COMMAND_INFO`: 인자 종류·설명·usage), `matchCommands`(접두), `suggestCommands`(`>` 전체, `>mo` 축약, `>move 프` → 주제 자동완성(한글 인식), open은 saved만, move/merge는 현재 주제 제외, close는 현재 창 우선), `rankTopics`, `findTopicByName`
  - 테스트 39건 추가(hangul 7, fuzzy 7, index 13(벤치 포함), command 12) → 총 153/153. typecheck·lint·build 통과
  - 성능: 1,100문서(탭 1,000 + 주제 100) 색인 83 ms, 쿼리 평균 **1.34 ms** (목표 10 ms). 최초 구현 19 ms → 쿼리 준비 1회화 + 대상 사전 압축 + 탭의 topicName 퍼지 제외로 개선
  - 수정: 오타 허용 테스트 데이터 오류(한글 제목에 영어 오타 기대) → 영어 토큰 케이스로 교체; 미사용 import 제거
- **결정**:
  - 하이브리드 검색: MiniSearch(토큰 prefix·오타) + 부분열 매처(약어 "gh"→github.com, 자모/초성). 데스크톱(nucleo)과 동작을 맞추기 쉬운 구조
  - 초성/자모 변환은 토큰 단위로 한글 토큰에만 적용 → "리액트 hooks" 같은 혼용 쿼리 지원
  - 커맨드는 첫 토큰이 유일한 접두 일치이고 공백이 따라올 때만 확정(`>mo 프` → move, `>m x`는 미확정)
- **산출물**: 소스 4개, 테스트 4개
- **커밋**: `9404ba5` (태그 `ext-v0.2.0`, #14~#16 일괄)

## #16 · 2026-09-12 · E06 Popup 검색창 + 정리 커맨드 + IME (F-02, F-08, F-11 Popup)

- **요청**: "다음" (E06 진행)
- **수행**:
  - `src/core/commandRunner.ts`: `CommandRunner` — `focus(target, mode)`(탭 활성화+창 포커스 / 창만; saved 주제·탭은 `restoreTopic`으로 복원 후 URL 매칭 활성화), `restoreTopic`(저장 탭 URL로 `windows.create` → `waitForWindow` → `adoptWindow`), `move`(saved면 복원, 이미 대상 창에 있는 탭 제외, moveLog 기록, `lastMoveTopicId`, `switchTo`), `newTopic`(`windows.create({tabId})` + 나머지 이동 + 이름 지정), `rename`(topicId 또는 windowId), `merge`
  - `TopicService.adoptWindow(topicId, windowId)`: saved 주제를 새 창에 재연결. 창 이벤트가 먼저 도착해 자동 생성된 주제가 있으면 탭 행을 이관하고 병합, saved 행은 삭제(라이브 이벤트가 재생성)
  - `src/chrome/actions.ts`: `ChromeActions` 어댑터(`tabs.update/move`, `windows.update({focused, drawAttention})`, `windows.create`, `tabs.query`)
  - `src/core/searchDocs.ts`(Repo 스냅샷 → SearchDoc[]), `src/core/ime.ts`(`isCommitEnter`, `enterVariant`)
  - `background.ts`: SearchIndex를 SW에서 소유(이벤트 후 dirty → 다음 검색 시 재구축), `search`/`cmd.focus`/`cmd.move`/`cmd.new`/`cmd.rename`/`cmd.open`/`cmd.merge` 메시지, 컨텍스트 메뉴 "주제로 보내기 ▸ [새 주제로 / 주제 목록]"(500ms 디바운스 재구축), 단축키 `send-to-last-topic`(Ctrl+Shift+M), `waitForWindow`(트래커·서비스가 창을 인지할 때까지 최대 3초 폴링)
  - 팝업 `App.tsx` 전면 교체: 입력창 + 결과 목록(주제 행/탭 행/커맨드 제안 행), ArrowUp/Down, Enter(탭 이동)·Ctrl/⌘+Enter(창만)·Shift+Enter(보낸 뒤 이동)·Tab(제안 채움)·Esc(지우기/닫기), IME 가드, `#주제`/`@saved` 범위, 커맨드 자동완성, 실행 후 팝업 닫기 또는 안내 문구, 하단 힌트
  - manifest: `send-to-last-topic` 커맨드 추가
  - 테스트 21건 추가(commandRunner 15 — 가짜 Chrome 월드로 이벤트 파이프라인 재현, adoptWindow 3, searchDocs 1, ime 2) → 총 174/174. typecheck·lint·build 통과
- **결정**:
  - 검색은 SW에서 실행(팝업은 메시지만) — 단일 진실 원천, 인덱스는 변경 후 지연 재구축(1,100문서 83 ms)
  - saved 주제 복원은 **같은 주제 ID를 새 창에 재연결**(adoptWindow). 창 이벤트 경합은 자동 생성 주제 병합으로 해결
  - `>close`, `>save`는 E11(세션 저장)로 유보. `>open`, `>merge`는 이번에 구현
  - 창 포커스는 `windows.update({focused:true, drawAttention:true})`. Chrome이 백그라운드일 때의 OS 포커스 제약은 Desktop 몫(F-08)
- **산출물**: 소스 신규 5(commandRunner, searchDocs, ime, chrome/actions, popup 재작성), 수정 5(topicService, messages, background, wxt.config, style), 테스트 4
- **미검증**: Windows MS 한국어 IME / macOS 두벌식에서 조합 중 Enter 오동작 0 확인, 팝업 오픈→입력 가능 100 ms, 탭 보내기 200 ms — 사용자 실기기 확인 대기
- **커밋**: `9404ba5` (태그 `ext-v0.2.0`, #14~#16 일괄)

## #17 · 2026-09-12 · ext-v0.2.0 커밋

- **요청**: "커밋"
- **수행**: E04~E06 작업분(32파일, +3,975/-101)을 커밋 `9404ba5`로 커밋, annotated 태그 `ext-v0.2.0`. README/계획서/history의 "(미커밋)" 표기를 해시로 갱신하는 후속 커밋 1건
- **푸시**: 미푸시 (사용자 지시 대기)

## #18 · 2026-09-12 · 버그 수정: 리로드 후 복제 창이 열림

- **요청**: "버그 발견, 검색 후 구글 관련 검색 후 열으니 동일한 탭의 윈도우가 똑같이 열림. 시스템 속도 저하 및 버그" + 스크린샷(탭 구성이 같은 창 2개)
- **원인**: `Alt+R` 리로드마다 세션 마커가 초기화 → E04 로직이 열려 있던 주제를 전부 saved로 내리고 현재 창에 새 주제를 생성 → storage에 현재 창과 동일한 탭 목록의 저장 주제가 누적. 검색 결과에 그 저장 탭이 함께 노출되고, 선택 시 E06 복원 로직이 `windows.create(urls)`로 30여 개 탭짜리 복제 창을 생성
- **수정** (`src/core/topicService.ts`, `src/core/searchDocs.ts`):
  - `reconcile()` fresh session: stale open 주제를 곧바로 saved로 내리지 않고 **탭 지문 Jaccard ≥ 0.5**로 라이브 창과 1:1 그리디 매칭(`matchWindows`) → `relink()`(같은 id·이름 유지, 닫힘 처리 후 지문으로 행 재바인딩, 안 맞는 행 삭제). 미매칭만 saved
  - `dropDuplicateSavedTopics()`: 열린 창과 Jaccard ≥ 0.8인 **이름 없는** saved 주제 삭제(이미 쌓인 복제도 다음 리로드에서 정리). 이름 지정 주제는 보존
  - `syncTabsOfWindow`: 같은 지문의 닫힌 행을 재사용(id·lastActiveAt·subgroup 유지) — relink/복원 공용
  - `buildSearchDocs`: 열린 탭과 지문이 같은 저장 탭은 검색 문서에서 제외
  - 상수 `RELINK_MIN_JACCARD=0.5`, `DUPLICATE_MIN_JACCARD=0.8`, `jaccard()`, `liveFingerprints()` export
  - 테스트 6건 추가(`topicService.reload.test.ts`: 같은 windowId 재연결, 다른 windowId 재연결+닫힌 탭 정리, 미매칭 saved, 이름 없는 복제 삭제/이름 있는 복제 보존, 두 창 1:1 매칭, jaccard) + searchDocs 중복 제외 → 총 180/180. typecheck·lint·build 통과
- **결정**: E11로 미뤘던 지문 재매칭·복제 정리를 버그 수정으로 선반영 (계획서 원칙 "뒤 스텝 앞당기지 않기"의 예외 — 실사용 버그). E11에서는 `>close`/`>save`/JSON 내보내기와 옵션만 남음
- **사용자 조치 안내**: 복제 창 닫기 → `Alt+R` 리로드 → 리로드 시 자동 정리
- **커밋**: `e285bcb` (푸시 포함)

## #19 · 2026-09-12 · E07 Omnibox + 검색 무응답 수정

- **요청**: "다음 진행" → 중단 → "다음 진행 해줘 검색해도 검색이 안되" + 스크린샷(팝업에 "google" 입력 시 결과 없음)
- **E07 수행**:
  - `src/core/omniboxSuggest.ts`(순수): `encodeTarget/parseTarget`(`ctm:tab:<rowId>` / `ctm:topic:<id>`), `escapeXml`, `matchRanges`(토큰별 대소문자 무시 리터럴 매칭·병합), `highlight`(`<match>`), `suggestionFor`(주제: 이름·탭 수·상태 / 탭: 제목 + `<url>`host · 주제 · 저장됨), `buildSuggestions`(중복 content 제거, 6개), `defaultDescription`, `targetOf`
  - `src/chrome/omnibox.ts`: `onInputStarted/onInputChanged/onInputEntered/onInputCancelled` 연결, 세대 카운터로 늦은 응답 무시, 기본 제안 선택 시 최상위 검색 결과로 이동
  - `wxt.config.ts`: `omnibox: { keyword: 't' }`; `background.ts`: `registerOmnibox` 연결(검색은 SW 인덱스, 활성화는 `CommandRunner.focus`)
  - 테스트 16건 추가(`omniboxSuggest.test.ts`) → 총 196/196
- **검색 무응답 원인**: `wxt.config.ts`에 omnibox를 추가했지만 실행 중인 dev 서버가 dev manifest를 재생성하지 않음(02:18 manifest). 새 background.js(09:45)는 `browser.omnibox.onInputStarted.addListener`를 호출 → `chrome.omnibox` undefined → SW 시작 중 TypeError → 그 뒤에 등록되는 `runtime.onMessage` 리스너가 빠짐 → 팝업 `sendMessage`가 undefined 응답 → `res.type` 접근 예외 → "결과 없음". storage LevelDB를 직접 읽어 데이터는 정상임을 먼저 확인
- **수정**:
  - `chrome/omnibox.ts`: `browser.omnibox` 없으면 로그 후 skip. `background.ts`: `registerOmnibox`를 try/catch로 감싸 메시지 리스너 등록을 보장
  - 팝업 `App.tsx`: `send()`가 undefined 응답이면 "백그라운드가 응답하지 않습니다 — 확장 새로고침" 오류 throw, `refresh/loadContext`에서 오류를 화면에 표시(더 이상 조용히 "결과 없음" 아님)
  - dev 서버 재시작(PID 42956 종료 → `pnpm dev` 백그라운드, 포트 3000) → dev manifest에 omnibox 반영 확인
- **검증**: 테스트 196/196, typecheck·lint·build 통과. 프로덕션 manifest에 `"omnibox":{"keyword":"t"}` 확인
- **결정/교훈**: manifest(`wxt.config.ts`) 변경 시 dev 서버 재시작 필수. 선택적 Chrome API는 존재 여부를 확인하고 등록. CLAUDE.md에 기록
- **미검증**: 실기기에서 `t` + 키워드 → 제안 표시·Enter 전환, 팝업 검색 복구 — 사용자 확인 대기
- **커밋**: 미커밋

## #20 · 2026-09-12 · 팝업 빈 화면 → 정적 빌드 운영으로 전환

- **요청**: 스크린샷(팝업이 검은 사각형만 표시) + "검색창이 안나옴"
- **원인**: dev 서버 재시작으로 포트가 3001→3000으로 바뀌었는데 Chrome이 든 확장은 옛 manifest(CSP localhost:3001) → 팝업 스크립트 로드 차단 → 빈 화면. 곧이어 백그라운드로 띄운 dev 서버가 **시스템 메모리 부족으로 강제 종료**(free 1.1 GB, Chrome 64 프로세스 3.1 GB, 커밋 29.7/39.7 GB)
- **조치**:
  - dev 서버 의존을 제거: 프로덕션 빌드를 Chrome이 이미 로드한 `.output/chrome-mv3-dev` 폴더에 복사 → 확장 ID·storage 데이터 유지, localhost 참조 0
  - `scripts/sync-static.mjs` + `pnpm static`(= `wxt build && node scripts/sync-static.mjs`) 추가
  - 발견: `fs.cpSync({recursive:true})`가 이 환경(Node 24.14.1, 한글 사용자 경로)에서 네이티브 크래시(0xC0000409, bash exit 127) → `readdirSync`/`copyFileSync` 수동 복사로 우회
  - 남아 있던 wxt 프로세스(PID 52492) 종료로 메모리 확보
- **결정**: 이 머신에서는 수동 테스트 루프를 `pnpm static` → chrome://extensions ↻ 로 고정. dev 서버(HMR)는 선택. CLAUDE.md에 기록
- **사용자 조치 안내**: chrome://extensions에서 확장 새로고침(↻) → 팝업·검색 확인
- **커밋**: 미커밋

## #21 · 2026-09-12 · 진단 줄로 원인 확정 · 이름 붙은 복제 주제 흡수

- **요청**: 스크린샷 3장 — (1) 검색 결과 없음 → (2) 진단 줄 없이 동일 → (3) 새 SW 적용 후 검색 정상, 그러나 저장된 "Dev _info"(35탭)를 선택하면 창이 열리는 대신 35탭 새 창이 생성되고 느려짐. 진단 줄: 주제 3/19 · 탭 56/554 · 색인 145 · 창 3 · 라이브탭 56 · seq 32 · 저장 253KB
- **경과**:
  - 팝업 파일은 디스크에서 즉시 읽히지만 서비스워커는 확장 새로고침 시에만 교체됨 → 새 팝업이 옛 SW에 `debug.stats`를 보내 "unknown message"를 받았고, 팝업이 그 오류를 숨김 → 진단 오류도 표시하도록 수정. storage 사용량(KB) 추가
  - `Repo.init`: meta 키가 없어도 컬렉션에 데이터가 있으면 절대 지우지 않고 meta만 재작성 (테스트 추가)
  - 확장 새로고침 후 진단 정상 표시, 검색 동작 확인. 09:42 이후 쓰기 없음은 옛 SW가 죽어 있던 결과였음
- **버그 원인**: #18의 정리 로직이 **이름 없는** 복제만 삭제 → 사용자가 이름 붙인 옛 복제("Dev _info", "DEV_Info")가 saved로 남고, 선택 시 복원 로직이 새 창 생성
- **수정**:
  - `TopicService.openDuplicateOf` / `absorbIfDuplicate`: 열린 창과 Jaccard ≥ 0.8인 저장 주제는 이름 여부와 무관하게 흡수 — 열린 주제가 이름 없음이면 이름 상속(중복 이름 충돌 시 생략), 복제 삭제. `dropDuplicateSavedTopics`가 이를 사용
  - `CommandRunner.restoreTopic`: 새 창 생성 전에 `absorbIfDuplicate` → 겹치면 기존 창 id 반환(이중 안전장치)
  - 테스트: reload 2건(이름 상속, 이름 유지), commandRunner 1건(복제 선택 → createWindow 없이 focus) → 총 200/200
- **결정**: 열린 창의 복제 저장본은 사용자 데이터가 아니라 리로드 잔재로 간주(라이브 창이 같은 탭을 전부 가짐). 이름만 승계
- **사용자 조치 안내**: 확장 새로고침 → 리로드 시 남은 복제("Dev _info" 등)가 자동 흡수됨. 이후 저장 목록에서 선택해도 기존 창으로 이동
- **커밋**: 미커밋

## #22 · 2026-09-12 · E08 Side Panel 개요 + 하위 그룹 (F-03, F-11 Side Panel)

- **요청**: "다음 진행" (E08)
- **수행**:
  - `core/liveState.ts`: `LiveGroup`(id, windowId, title, color, collapsed), `state.groups`, 이벤트 `group.created/updated/removed`, init에 `groups`, 창 제거 시 그룹 제거, `groupsOf()`
  - `chrome/events.ts`: `tabGroups.on*` 구독(권한 없거나 fake일 때 안전하게 건너뜀), `loadInitialState`가 `tabGroups.query({})` 포함, `toLiveGroup`
  - `core/topicService.ts`: `Subgroup` 행 관리 — `onGroupUpsert`(chromeGroupId→없으면 이름으로 매칭, 탭 재바인딩), `onGroupRemoved`(열린 탭 남아 있으면 삭제=사용자가 그룹 해제, 전부 닫혔으면 창 닫힘으로 보고 이름·색 보존), `syncGroupsOfWindow`(reconcile), `rowFor`가 `LiveTab.groupId`로 `subgroupId` 부여, `toSaved`에서 chromeGroupId 해제, `setColor()`, `tree()`(주제→하위 그룹→탭), `toTopicColor`, `sameRow`에 subgroupId 포함
  - `core/messages.ts` / `background.ts`: `sidepanel.tree`, `topic.setColor`
  - `entrypoints/sidepanel/`(Solid): 열린 주제 카드(현재 창 강조, 접기, 색상 점→팔레트, 이름 인라인 편집, 탭 수, ↗ 창 이동), 하위 그룹 블록(색 테두리), 탭 행 클릭→이동, **드래그 앤 드롭으로 다른 주제 카드에 놓으면 `cmd.move`**, 저장된 주제 섹션(⤴ 복원), 탭/창 이벤트로 300ms 디바운스 자동 갱신
  - 팝업 하단 "사이드 패널" 링크(`sidePanel.open({windowId})`, 사용자 제스처 내)
  - manifest: 권한 `tabGroups`, `sidePanel`, `side_panel.default_path`
  - 테스트 9건 추가(liveState 그룹 2, events 그룹 매핑 1, topicService 그룹 6) → 총 209/209. typecheck·lint·build 통과. fake-browser의 tabGroups 이벤트는 stub으로 대체
- **결정**: EXT는 Chrome Tab Group을 **읽기만** 한다(생성·변경 0, 계획서 DoD). 주제 색상은 UI 배지로만 쓰고 그룹 색을 강제하지 않음. 그룹 제거 이벤트의 의미(해제 vs 창 닫힘)는 남은 열린 탭 유무로 판별
- **미검증**: 실기기에서 그룹 표시, 드래그 이동, 색상·이름 편집, 창 닫힘 후 저장 주제에 그룹 이름 보존 — 사용자 확인 대기
- **커밋**: 미커밋 (E07·버그 수정 2건과 함께 예정. EM3 완료 태그 `ext-v0.3.0`은 E07 기준)

## #23 · 2026-09-12 · 사용자 피드백: "검색·목록은 현재 열린 창·탭 기준이어야" → 보존 정책 변경

- **요청**: 사이드 패널 스크린샷 — 이미 닫힌 창("file://C:", 36탭, 이름 없음)이 저장된 주제로 계속 표시됨. "모든 검색 대상이나 설정 대상은 현재 열려진 창과 탭을 기준으로 해야 함" → 이어서 "사용자 입장을 고려한 UI/UX 정책으로 전환, 분류 정책을 다시 추천"
- **원인**: E04 정책이 창을 닫으면 이름 유무와 무관하게 saved 주제로 보존 → 자동 이름 주제가 닫힐 때마다 누적되어 검색·패널에 노출
- **수정 (코드)**:
  - `TopicService.toSaved`: **이름 지정 주제만** saved로 보존, 이름 없는 주제는 창과 함께 삭제
  - `reconcile`: 남아 있는 이름 없는 saved 주제 전부 정리(레거시)
  - 검색 범위 `open` 추가 — 팝업·Omnibox 기본 범위를 `open`(현재 열린 창·탭)으로. 저장 항목은 `@saved`·`#주제`로만
  - `autoName`: file://·chrome:// 등 비웹 페이지는 탭 제목 사용, 여러 탭이면 웹 host만 집계 ("file://C:" 이름 제거)
  - 테스트 갱신·추가 → 213/213, typecheck·lint·build 통과, 정적 빌드 반영
- **정책 추천은 별도 답변으로 제시(사용자 확정 대기)**. 확정 시 기능정의서 v0.3로 반영 예정
- **커밋**: 미커밋

## #24 · 2026-09-12 · 정책 v0.3 확정: 주제 수명 = 창 수명, 저장된 주제 폐지

- **요청**: "아무리 지정 주제라도 현재 열려있지 않은 윈도우는 필요없고… 사진처럼 과거 이미 사라진 그룹들이 동일한 그룹으로 너무 많아" / "닫혀 버린 예전 기록이 같이 남아 있어 이건 싹 다 지워야지" (스크린샷: 저장된 주제 16개, 이름 붙은 잔재 3개)
- **결정 (사용자)**: 열려 있지 않은 창의 주제는 이름 유무와 무관하게 **전부 삭제**. "저장된 주제" 개념 폐지. 검색·팝업·사이드 패널은 현재 열린 창·탭만
- **수행**:
  - `TopicService.toSaved` → 항상 `deleteTopic`(탭·하위 그룹 cascade). `reconcile`: 잔존 `saved` 주제 전부 삭제(현재 창과 Jaccard ≥ 0.8이면 `absorbIfDuplicate`로 이름만 승계 후 삭제). `adoptWindow` 제거
  - `CommandRunner`: `restoreTopic` 제거, `focus`/`move`는 열린 주제만(`requireOpenTopic`), `restored` 필드 제거
  - `command.ts`: `open`/`save` 커맨드와 `@saved` 모드 제거 (남은 커맨드 move/new/rename/close/merge). 팝업 힌트·케이스, 사이드 패널 "저장된 주제" 섹션, `cmd.open` 메시지 제거
  - 검색 기본 범위 `open`(팝업·Omnibox). `autoName`: file://·chrome://는 탭 제목 사용
  - 테스트 정리: adopt 테스트 파일 삭제, 복원 관련 4건 삭제, 창 닫힘·재시작·그룹·명령 테스트를 새 정책으로 갱신 → 205/205. typecheck·lint·build 통과, 정적 빌드 반영
  - 문서: 기능정의서 v0.3(변경 이력, §1.5, 용어, F-09/F-12), DEV_PLAN E11 범위 축소, CLAUDE.md, README
- **트레이드오프 기록**: 실수로 창을 닫으면 주제(이름·색·그룹)는 사라지고 탭은 Chrome "최근 닫은 탭"에만 남음. 브라우저 재시작은 Chrome 세션 복원 + 지문 재연결로 이름 유지
- **사용자 조치**: 확장 새로고침(↻) → 잔재 16개 전부 정리, 이름 붙은 잔재가 현재 창과 같은 탭 구성이면 그 이름이 창에 붙음
- **커밋**: 미커밋
