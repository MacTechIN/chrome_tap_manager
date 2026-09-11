# Chrome_Project_manager 앱 기능정의서

- 문서 버전: 0.1 (초안)
- 작성일: 2026-09-11
- 근거 문서: `docs/project_definition.md`, `docs/research.md`
- 상태: 기술 스택 선정 완료(리서치 기준), 상세 UI 시안·API 스키마는 후속 문서에서 확정

---

## 1. 제품 개요

### 1.1 한 줄 정의
개발 목적으로 Chrome을 많이 쓰는 사용자가 **탭을 주제(Topic)별로 정리하고, 같은 주제의 탭을 하나의 창으로 모으고, 화면 한구석에 떠 있는 Spotlight형 검색창에서 키워드 한 번으로 해당 탭이 있는 Chrome 창을 즉시 앞으로 불러오는** 개발자용 유틸리티.

### 1.2 산출물 (2종, 기능 동일 / 형태 상이)

| 산출물 | 형태 | 역할 |
|---|---|---|
| **Chrome Extension** (이하 EXT) | MV3 확장 (WXT + TypeScript) | Chrome 내부의 탭/그룹/창 조작, 탭 이벤트 수집, Chrome 안에서의 폴백 검색 UI |
| **Desktop App** (이하 APP) | Windows / macOS 램 상주 트레이 앱 (Tauri v2, Rust) | 글로벌 단축키로 뜨는 Spotlight형 검색창, 주제/탭 데이터의 source of truth, OS 레벨 창 전면화 |

두 산출물은 Native Messaging(프록시 호스트 → 로컬 소켓/파이프)로 연결된다. EXT 단독으로도 축소된 기능(주제 관리 + Chrome 내부 검색)이 동작해야 하며, APP는 EXT가 연결되어야 완전 기능이 활성화된다.

### 1.3 대상 사용자
- 프로젝트·이슈·레퍼런스별로 수십~수백 개 탭을 동시에 여는 개발자
- 한글·영문 혼용 검색이 필요한 한국어 사용자 (1차)
- Windows 11, macOS 최신 2개 버전 사용자

### 1.4 핵심 가치
1. **찾기**: 탭이 어디 있는지 기억할 필요 없이 키워드로 즉시 이동 (목표: 단축키 → 창 전면화 300 ms 이내)
2. **정리**: 주제 단위로 탭을 묶고, 주제당 Chrome 창 하나로 물리적으로 분리
3. **자동화**: 검색창에서 주제의 탭 묶음을 한 번에 열기 / 새 탭을 주제에 바로 귀속

---

## 2. 용어 정의

| 용어 | 정의 |
|---|---|
| **Topic (주제)** | 사용자가 정의한 탭 묶음의 단위. 이름, 색상, 선택적 URL 규칙을 가진다. Chrome 안에서는 Tab Group으로, 물리적으로는 1개 Chrome 창으로 매핑되는 것을 목표로 한다. |
| **Managed Tab (관리 탭)** | 어떤 Topic에 귀속된 탭. Chrome `tabId`는 재시작 시 바뀌므로 URL + title 지문으로 identity를 유지한다. |
| **Unassigned Tab (미분류 탭)** | Topic이 없는 탭. 검색 대상에는 포함된다. |
| **Topic Window** | 특정 Topic의 탭만 모아 둔 Chrome 창. |
| **Saved Tab (저장 탭)** | 현재 열려 있지 않지만 Topic에 기록되어 있어 다시 열 수 있는 탭 (URL, title, favicon). |
| **Launcher (런처)** | APP의 Spotlight형 검색창. |
| **Bridge (브리지)** | EXT ↔ APP 통신 채널 (Native Messaging 프록시 + 소켓/파이프). |

---

## 3. 기능 목록 (요약)

| ID | 기능 | 담당 | 우선순위 |
|---|---|---|---|
| F-01 | Topic 생성/수정/삭제 | EXT, APP | P0 |
| F-02 | 탭을 Topic에 수동 귀속/해제 | EXT | P0 |
| F-03 | Topic ↔ Chrome Tab Group 동기화 | EXT | P0 |
| F-04 | Topic 탭을 한 창으로 모으기 (Topic Window) | EXT | P0 |
| F-05 | 탭 이벤트 수집 및 APP 동기화 | EXT, Bridge | P0 |
| F-06 | 런처 표시/숨김 (글로벌 단축키, 트레이) | APP | P0 |
| F-07 | 키워드 검색 (한글 초성/자모 + 영문 퍼지) | APP, EXT | P0 |
| F-08 | 검색 결과 선택 → 해당 탭/창 전면화 | APP, EXT | P0 |
| F-09 | 검색창에서 Topic 일괄 열기 / 저장 탭 재열기 | APP, EXT | P1 |
| F-10 | URL 규칙 기반 자동 Topic 귀속 | EXT | P1 |
| F-11 | Chrome 내부 폴백 검색 (Popup / Omnibox / Side Panel) | EXT | P1 |
| F-12 | 세션 저장/복원 (Topic 스냅샷) | APP, EXT | P1 |
| F-13 | 시맨틱 검색 (온디바이스 임베딩, 옵트인) | APP, EXT | P2 |
| F-14 | 자동 주제 제안 (클러스터링 + 레이블) | APP | P2 |
| F-15 | 설정 (단축키, 자동 시작, 테마, 데이터 내보내기) | APP, EXT | P1 |
| F-16 | 다중 Chromium 브라우저 (Edge/Brave) 지원 | Bridge | P2 |

---

## 4. 기능 상세

### F-01 Topic 생성 / 수정 / 삭제 (P0)
- 입력: 이름(필수, 1~50자), 색상(Chrome Tab Group 9색 중 택1), 설명(선택), URL 규칙(선택, F-10)
- EXT Side Panel 및 APP 런처(`>new <이름>` 커맨드) 양쪽에서 생성 가능
- 삭제 시 귀속 탭은 Unassigned로 변경 (탭 자체는 닫지 않음). 저장 탭은 확인 후 삭제
- 이름 중복 불가 (대소문자 무시)

### F-02 탭을 Topic에 수동 귀속 / 해제 (P0)
- Side Panel에서 드래그 앤 드롭 또는 탭 우클릭 컨텍스트 메뉴 "Topic에 추가 ▸"
- 현재 활성 탭을 단축키(`chrome.commands`)로 마지막 사용 Topic에 즉시 귀속
- 귀속 시 즉시 F-03 동기화 실행
- 하나의 탭은 하나의 Topic에만 귀속

### F-03 Topic ↔ Chrome Tab Group 동기화 (P0)
- Topic에 귀속된 탭은 같은 창 내에서 `tabs.group` → `tabGroups.update({title, color})`로 Tab Group에 배치
- 사용자가 Chrome UI에서 직접 그룹명/색상을 바꾸면 `tabGroups.onUpdated`로 Topic에 역반영
- 사용자가 Chrome UI에서 탭을 그룹 밖으로 빼면 Unassigned로 처리 (설정으로 "무시" 선택 가능)

### F-04 Topic Window — 한 창으로 모으기 (P0)
- Topic 컨텍스트 메뉴 "창으로 모으기": `windows.create({tabId})` + `tabs.move`로 해당 Topic 탭 전부를 새 창으로 이동
- 이미 Topic Window가 있으면 그 창으로 이동 (창 신규 생성 X)
- 옵션 "새 탭을 Topic Window에 자동 이동": Topic Window 밖에서 해당 Topic으로 귀속된 탭을 자동 이동
- Topic Window의 `windowId`는 `storage.session`에 보관, Chrome 재시작 시 F-12로 복원

### F-05 탭 이벤트 수집 및 APP 동기화 (P0)
- EXT 서비스워커가 `tabs.onCreated/onUpdated/onRemoved/onMoved/onAttached/onDetached/onActivated`, `windows.onRemoved/onFocusChanged`, `tabGroups.on*`를 구독
- 각 이벤트를 단조 증가 `seq`가 붙은 델타 메시지로 Bridge를 통해 APP에 push
- 연결/재연결 시 APP가 전체 스냅샷을 요청, EXT가 `tabs.query({})` 결과 전체를 전송 (full resync)
- APP 미실행 시 EXT는 `storage.local`에 마지막 상태를 유지하고 재연결 시 재전송
- Bridge 메시지 크기 1 MB 제한을 고려해 스냅샷은 페이지 분할 (탭 200개 단위)

### F-06 런처 표시 / 숨김 (P0)
- 트레이(메뉴바) 아이콘 상주, Dock/작업표시줄 아이콘 없음 (macOS `ActivationPolicy::Accessory`)
- 기본 글로벌 단축키: Windows `Ctrl+Shift+Space`, macOS `⌥+Space` (설정에서 변경 가능, 충돌 시 등록 실패를 사용자에게 알림)
- 런처 창: 프레임리스, always-on-top, 반투명 배경, 화면 상단 중앙 (마지막 위치 기억 옵션)
- macOS는 비활성화 NSPanel(`tauri-nspanel`)로 구현하여 현재 앱 포커스를 빼앗지 않음
- Esc / 포커스 이탈 시 숨김. 단축키 재입력 시 토글
- 로그인 시 자동 시작 (기본 ON, 설정에서 OFF 가능)
- 트레이 메뉴: 런처 열기, 일시 정지(단축키 해제), Chrome 연결 상태, 설정, 종료

### F-07 키워드 검색 (P0)
- 검색 대상: 열린 탭(title, URL host/path, Topic 이름), 저장 탭, Topic 이름
- 매칭:
  - 영문/숫자: 퍼지 매칭 (fzf 스타일, nucleo)
  - 한글: 원문 + 자모 분해 + 초성 3중 색인 → "ㅊㄹ" → "초록", "채ㅌ" → "챗봇" 등 부분 입력 매칭
  - URL은 host를 가중치 높게 (예: "gh" → github.com)
- 랭킹: 매칭 점수 + 최근 활성화(MRU) 가중 + 현재 창 우선
- 결과 행: favicon, 제목, 도메인, Topic 배지(색상), 창 구분 표시
- 필터 접두어: `#<topic>` (Topic 내 검색), `>` (커맨드 모드: new, close, collect 등), `@saved` (저장 탭만)
- 입력은 `input` 이벤트 기준으로 실시간 필터, IME 조합 중 Enter 무시 (`isComposing` 가드)
- 성능 목표: 탭 1,000개 기준 키 입력 → 결과 갱신 10 ms 이내
- EXT 단독(APP 미연결) 시 동일 로직을 MiniSearch + es-hangul로 Popup/Side Panel에서 제공 (F-11)

### F-08 결과 선택 → 탭 / 창 전면화 (P0)
- Enter: 선택된 탭 활성화 + 창 전면화. `Ctrl/⌘+Enter`: 해당 Topic Window 전체를 앞으로
- 시퀀스:
  1. APP → Bridge → EXT: `{action:"focus", tabId, windowId}`
  2. EXT: `tabs.update(tabId,{active:true})` → `windows.update(windowId,{focused:true})` → 창 제목 회신
  3. APP: 회신된 제목/HWND로 OS 레벨 활성화
     - Windows: `EnumWindows`로 `Chrome_WidgetWin_1` + 제목 매칭 → `ShowWindow(SW_RESTORE)` → `SetForegroundWindow` (실패 시 `AttachThreadInput` 폴백)
     - macOS: `osascript` `tell application "Google Chrome"` → `set index of window id W to 1` → `activate` (Automation 권한 안내 UI 포함)
  4. 런처 숨김
- 저장 탭(현재 닫힘) 선택 시: 해당 Topic Window(없으면 새 창)에 `tabs.create` 후 동일 시퀀스
- 실패 처리: EXT 미연결 시 결과 행에 "Chrome 연결 필요" 배지, Enter 시 연결 안내

### F-09 검색창에서 Topic 일괄 열기 / 저장 탭 재열기 (P1)
- `>open <topic>`: 해당 Topic의 저장 탭 중 열려 있지 않은 것을 Topic Window에 일괄 오픈
- `>collect <topic>`: F-04 "창으로 모으기" 실행
- `>close <topic>`: Topic Window의 탭을 저장 탭으로 전환 후 창 닫기 (확인 필요)
- `>save`: 현재 창 전체를 지정 Topic의 저장 탭으로 기록

### F-10 URL 규칙 기반 자동 Topic 귀속 (P1)
- Topic마다 규칙 목록: host 일치(`github.com`), host+path 접두어(`github.com/MacTechIN/*`), 정규식(고급)
- `tabs.onUpdated`에서 URL 확정 시 규칙 평가 → 첫 매칭 Topic에 자동 귀속 (수동 귀속이 이미 있으면 유지)
- 규칙 충돌 시 우선순위는 목록 순서
- Side Panel에서 "이 탭으로 규칙 만들기" 원클릭 제공

### F-11 Chrome 내부 폴백 검색 (P1)
- **Popup**: 툴바 아이콘 클릭 또는 `chrome.commands` 단축키로 F-07과 동일한 검색 UI (MiniSearch)
- **Omnibox**: 주소창에 키워드(기본 `t`) + 스페이스 → 탭 제안 → 선택 시 탭 전환
- **Side Panel**: Topic 트리(Topic → 열린 탭 / 저장 탭), 드래그 앤 드롭, 창으로 모으기, 규칙 편집
- APP 없이도 Chrome이 활성 앱일 때는 `windows.update({focused})`만으로 창 전환 가능. Chrome이 백그라운드일 때의 제약은 UI에 안내

### F-12 세션 저장 / 복원 (P1)
- APP SQLite에 Topic → 저장 탭 스냅샷을 항상 유지 (탭 닫힘 시 자동으로 저장 탭으로 전환하는 옵션)
- Chrome 재시작 후 EXT `onStartup`에서 APP 스냅샷과 현재 탭을 URL+title 지문으로 대조하여 Topic/Tab Group을 복원
- 수동 "스냅샷 저장/복원" 및 JSON 내보내기/가져오기 (F-15)
- 충돌 규칙: 탭별 `updated_at` last-writer-wins

### F-13 시맨틱 검색 (P2, 옵트인)
- 설정에서 활성화 시 `multilingual-e5-small` int8(약 118 MB) 다운로드 (동의 UI 필수)
- APP: fastembed-rs로 title+URL 임베딩 → sqlite-vec 저장. EXT: offscreen document + transformers.js (동일 모델, 벡터 호환)
- 랭킹: 키워드 결과 우선, 키워드 결과가 없거나 3개 미만일 때 시맨틱 결과를 보강
- 임베딩 계산은 탭 생성/제목 변경 시 백그라운드로, 런처 응답 지연 없음

### F-14 자동 주제 제안 (P2)
- Tier 0: URL host/path 규칙 + 제목 키워드 중첩으로 그룹 후보 생성
- Tier 1: F-13 임베딩 기반 agglomerative/HDBSCAN 클러스터링, 레이블은 TF-IDF 상위 단어
- Tier 2 (선택): 데스크톱 로컬 LLM(Qwen2.5-1.5B 등)으로 한국어 레이블 생성. Chrome Prompt API(Gemini Nano)는 한국어 미지원이므로 영문 레이블에만 사용
- 제안은 Side Panel "제안" 탭에 표시, 사용자가 승인해야 실제 Topic 생성 (자동 적용 없음)

### F-15 설정 (P1)
- 단축키 (런처 열기, 활성 탭 귀속), 자동 시작, 런처 위치/테마, 새 탭 자동 이동, 탭 닫힘 시 저장 탭 전환, 시맨틱 검색 옵트인
- 데이터: JSON 내보내기/가져오기, 전체 초기화
- 연결 상태 진단: Bridge 연결 여부, 호스트 manifest 등록 상태, 재등록 버튼
- macOS 권한 상태(Automation) 표시 및 시스템 설정 바로가기

### F-16 다중 Chromium 브라우저 (P2)
- 인스톨러가 Chrome / Edge / Brave / Chromium의 Native Messaging Host manifest 경로에 모두 등록
- APP 데이터 모델에 `browser` 필드를 두어 검색 결과에 브라우저 배지 표시
- Firefox / Safari는 범위 외

---

## 5. 비기능 요구사항

| 항목 | 요구 |
|---|---|
| 메모리 | APP 유휴 RAM 80 MB 이하 (Tauri 기준), EXT 서비스워커는 유휴 시 종료 허용 |
| 응답 | 단축키 → 런처 표시 100 ms 이내, 검색 갱신 10 ms 이내, Enter → 창 전면화 300 ms 이내 |
| 규모 | 탭 2,000개, Topic 200개까지 성능 저하 없이 동작 |
| 오프라인 | 모든 기능이 네트워크 없이 동작 (모델 다운로드 제외) |
| 보안 | Bridge 인증은 `allowed_origins`(확장 ID 고정 `key`)로만. 로컬 소켓/파이프는 사용자 계정 권한으로 제한. localhost 리스너 개방 금지 |
| 프라이버시 | 탭 URL/제목은 로컬에만 저장. 외부 전송 없음. 텔레메트리 없음 |
| 안정성 | APP 종료/크래시 시 EXT는 독립 동작, 재연결 시 자동 full resync |
| 플랫폼 | Windows 11 (x64/ARM64), macOS 13+ (Apple Silicon/Intel) |
| 서명 | Windows Authenticode, macOS 공증 + `com.apple.security.automation.apple-events` entitlement |
| 언어 | UI 한국어/영어, 검색은 한글·영문 혼용 |

---

## 6. 시스템 구성 및 데이터

### 6.1 구성

```
┌──────────────────────────────┐        native messaging          ┌─────────────────────────────────┐
│  Chrome Extension (WXT/TS)   │  stdio  ┌──────────────┐ socket/ │  Tray App (Tauri v2, Rust)       │
│  - MV3 service worker        │◄───────►│ proxy host   │◄───────►│  - Launcher (NSPanel / topmost)  │
│  - Side panel / Popup        │         │ (Rust)       │  pipe   │  - SQLite (source of truth)       │
│  - Omnibox                   │         └──────────────┘         │  - nucleo 검색 + 한글 자모 색인    │
│  - storage.local 캐시        │                                  │  - OS 창 전면화                   │
│  - offscreen (임베딩, 옵션)   │                                  │  - sqlite-vec / 임베딩 (옵션)     │
└──────────────────────────────┘                                  └─────────────────────────────────┘
```

### 6.2 데이터 모델 (APP SQLite, source of truth)

| 테이블 | 주요 컬럼 |
|---|---|
| `topic` | `id`, `name`(unique), `color`, `description`, `window_id`(nullable, 휘발), `created_at`, `updated_at` |
| `tab` | `id`, `topic_id`(nullable), `fingerprint`(url+title 해시), `url`, `title`, `favicon`, `browser`, `chrome_tab_id`(nullable), `chrome_window_id`(nullable), `is_open`, `last_active_at`, `updated_at` |
| `rule` | `id`, `topic_id`, `kind`(host/prefix/regex), `pattern`, `priority` |
| `tab_vec` (옵션) | `tab_id`, `embedding` (sqlite-vec) |
| `setting` | `key`, `value` |

EXT `storage.local`은 위 데이터의 캐시 + `seq` 커서. `storage.session`은 `windowId ↔ topic` 매핑 등 휘발 상태.

### 6.3 Bridge 메시지 (초안)

| 방향 | type | payload |
|---|---|---|
| EXT→APP | `hello` | `{extVersion, browser, lastSeq}` |
| APP→EXT | `snapshot_request` | `{}` |
| EXT→APP | `snapshot` | `{page, total, tabs[], windows[], groups[]}` |
| EXT→APP | `delta` | `{seq, event, tab/window/group}` |
| APP→EXT | `focus` | `{tabId, windowId}` |
| EXT→APP | `focus_result` | `{ok, windowTitle, windowId}` |
| APP→EXT | `open` | `{topicId, urls[], windowId?}` |
| APP→EXT | `collect` | `{topicId}` |
| APP→EXT | `assign` | `{tabId, topicId}` |
| APP→EXT | `topics_update` | `{topics[]}` |
| 양방향 | `ping` / `pong` | `{}` |

메시지는 JSON, host→ext 1 MB 제한 준수. 스키마는 별도 문서로 확정.

---

## 7. 범위 외 (v1)
- 클라우드 동기화 / 다중 기기 공유
- 페이지 본문 전문 검색 (제목·URL만 색인)
- Firefox, Safari 지원
- 모바일
- 탭 내용 요약, 클라우드 LLM 연동

---

## 8. 릴리스 단계

| 단계 | 포함 기능 | 완료 기준 |
|---|---|---|
| **M1 EXT 코어** | F-01, F-02, F-03, F-04, F-11(Popup) | Chrome만으로 Topic 관리 + 팝업 검색 + 창 모으기 동작 |
| **M2 Bridge + 런처** | F-05, F-06, F-07, F-08 | 글로벌 단축키 → 검색 → 창 전면화가 Windows/macOS 양쪽에서 300 ms 이내 |
| **M3 자동화·세션** | F-09, F-10, F-11(Omnibox/Side Panel), F-12, F-15 | 규칙 자동 귀속, 세션 복원, 설정 완비, 서명 배포 |
| **M4 AI(옵션)** | F-13, F-14, F-16 | 옵트인 시맨틱 검색 + 주제 제안, Edge/Brave 지원 |

---

## 9. 미결 사항
1. EXT UI 프레임워크 (Solid/Svelte vs React) — APP 웹뷰와 통일 여부
2. 런처 기본 단축키 충돌 검토 (macOS `⌥+Space`는 일부 런처와 충돌)
3. Topic Window 강제 여부: 주제당 창 1개를 강제할지, Tab Group만으로도 허용할지 (초안은 "선택 사항"으로 둠)
4. 탭 닫힘 → 저장 탭 자동 전환의 기본값 (ON이면 저장 탭이 빠르게 늘어남)
5. 인스톨러 형식 (Windows MSI/NSIS, macOS DMG/pkg) 및 Native Host manifest 등록 시점
