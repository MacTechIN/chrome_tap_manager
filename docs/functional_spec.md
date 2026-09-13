# Chrome_Project_manager 앱 기능정의서

- 문서 버전: 0.3
- 작성일: 2026-09-11 (v0.1) / 개정: 2026-09-11 (v0.2), 2026-09-12 (v0.3)
- 근거 문서: `docs/project_definition.md`, `docs/research.md`
- 상태: 기술 스택 선정 완료, **정리 모델 "창 = 주제" 확정(v0.2), 주제 수명 = 창 수명(v0.3)**. 상세 UI 시안·API 스키마는 후속 문서에서 확정

### 변경 이력
| 버전 | 날짜 | 내용 |
|---|---|---|
| 0.1 | 2026-09-11 | 초안 |
| 0.3 | 2026-09-12 | **주제의 수명 = 창의 수명.** 창이 닫히면 이름이 있어도 주제는 사라진다("저장된 주제" 개념 폐지, 사용자 실사용 피드백). 검색·패널 대상은 현재 열린 창·탭뿐. `@saved`, `>open`, `>save` 삭제. 브라우저 재시작 시 Chrome 세션 복원으로 돌아온 창은 탭 지문(Jaccard ≥ 0.5)으로 기존 주제(이름·색상·하위 그룹)에 재연결. F-04/F-07/F-09/F-11/F-12 개정, 데이터 모델 `status`는 항상 `open` |
| 0.2 | 2026-09-11 | 정리 모델을 "창 하나 = 주제 하나"로 확정. Topic 정의 변경, F-01~F-04 재정의, F-03(Tab Group)을 P1 보조로 강등, F-02 기본 경로를 검색창 커맨드로 변경, F-10에 행동 학습 제안 추가, 미결 사항 3번 종결 |

---

## 1. 제품 개요

### 1.1 한 줄 정의
개발 목적으로 Chrome을 많이 쓰는 사용자가 **작업마다 창 하나를 열고 이름 하나를 붙이면 그것이 곧 주제(Topic)가 되고**, 화면 한구석에 떠 있는 Spotlight형 검색창에서 키워드 한 번으로 해당 탭이 있는 Chrome 창을 즉시 앞으로 불러오는 개발자용 유틸리티.

### 1.2 산출물 (2종, 기능 동일 / 형태 상이)

| 산출물 | 형태 | 역할 |
|---|---|---|
| **Chrome Extension** (이하 EXT) | MV3 확장 (WXT + TypeScript) | Chrome 내부의 창/탭/그룹 조작, 창·탭 이벤트 수집, Chrome 안에서의 검색·정리 UI |
| **Desktop App** (이하 APP) | Windows / macOS 램 상주 트레이 앱 (Tauri v2, Rust) | 글로벌 단축키로 뜨는 Spotlight형 검색창, 주제/탭 데이터의 source of truth, OS 레벨 창 전면화 |

두 산출물은 Native Messaging(프록시 호스트 → 로컬 소켓/파이프)로 연결된다. EXT 단독으로도 축소된 기능(주제 관리 + Chrome 내부 검색)이 동작해야 하며, APP는 EXT가 연결되어야 완전 기능이 활성화된다.

### 1.3 대상 사용자
- 프로젝트·이슈·레퍼런스별로 수십~수백 개 탭을 동시에 여는 개발자
- 한글·영문 혼용 검색이 필요한 한국어 사용자 (1차)
- Windows 11, macOS 최신 2개 버전 사용자

### 1.4 핵심 가치
1. **찾기**: 탭이 어디 있는지 기억할 필요 없이 키워드로 즉시 이동 (목표: 단축키 → 창 전면화 300 ms 이내)
2. **정리**: 창이 곧 주제. 정리 동작은 "이 탭을 저 주제로 보내기" 하나뿐
3. **자동화**: 검색창에서 주제 창 닫기·합치기, 반복 행동을 규칙으로 학습

### 1.5 정리 모델 (v0.2 확정, v0.3 보완): 창 하나 = 주제 하나, 주제 수명 = 창 수명

사용자 관점의 한 줄 설명: **"작업마다 창 하나, 이름 하나. 찾을 땐 단축키 누르고 이름 치면 그 창이 뜬다."**

| 원칙 | 내용 |
|---|---|
| 설정 없이 시작 | 모든 일반 Chrome 창은 자동으로 Topic이 된다. 이름은 EXT가 대표 도메인/첫 탭 제목으로 임시 부여하고, 사용자는 원할 때만 바꾼다 |
| 정리 동작은 하나 | "이 탭을 → [주제]로 보내기". 검색창에서 주제 이름 + Enter로 현재 탭이 그 창으로 이동한다 |
| 검색창이 곧 정리 도구 | 같은 검색창에서 탭 찾기, 주제로 보내기, 새 주제(새 창) 만들기, 이름 바꾸기를 한다 |
| 탭 그룹은 보조 | 창 안에서 더 나누고 싶을 때만 Chrome Tab Group을 쓴다. 강제하지 않는다 |
| 규칙은 행동에서 학습 | 같은 도메인의 탭을 같은 주제로 두 번 보내면 "앞으로 자동으로 보낼까요?"를 한 번 묻는다. 규칙 편집 화면을 먼저 열게 하지 않는다 |
| 보이는 것 = 열린 것 | 주제는 창이 열려 있는 동안만 존재한다. 창을 닫으면 주제도 사라진다(이름 유무 무관). 검색·패널에는 지금 열린 창과 탭만 나온다. 브라우저 재시작 후 Chrome이 창을 복원하면 탭 지문으로 같은 주제(이름·색상·하위 그룹)를 다시 붙인다 |

선택 근거: 사용자가 이미 작업별로 창을 여는 습관을 그대로 활용하므로 학습·유지 비용이 거의 0이고, 검색 결과의 단위와 OS 레벨 포커스의 단위가 모두 "창"이라 이 프로젝트의 핵심 약속(창 전면화)과 정확히 맞물린다.

---

## 2. 용어 정의

| 용어 | 정의 |
|---|---|
| **Topic (주제)** | **하나의 일반(type=normal) Chrome 창에 1:1로 대응하는 작업 단위.** 이름, 색상, 선택적 URL 규칙을 가진다. 창과 함께 생기고 창과 함께 사라진다(v0.3). 재시작 시 복원된 창은 탭 지문으로 재연결 |
| **Topic Window** | Topic에 대응하는 Chrome 창. Topic은 항상 정확히 하나의 열린 창을 가진다 |
| **Unnamed Topic (이름 미지정 주제)** | 사용자가 아직 이름을 붙이지 않아 EXT가 임시 이름(대표 도메인 또는 첫 탭 제목)을 쓰는 Topic. 검색·이동은 정상 동작한다 |
| **Managed Tab (관리 탭)** | 일반 창 안의 모든 탭. 자기 창의 Topic에 자동 귀속되므로 "미분류 탭"은 존재하지 않는다. Chrome `tabId`는 재시작 시 바뀌므로 URL + title 지문으로 identity를 유지한다 |
| ~~Saved Tab~~ | v0.3에서 폐지. 닫힌 탭·창은 Chrome의 "최근 닫은 탭"이 담당 |
| **Sub-group (하위 그룹)** | 창 안에서 사용자가 선택적으로 만드는 Chrome Tab Group. Topic의 보조 구조 |
| **Launcher (런처)** | APP의 Spotlight형 검색창. EXT의 Popup 검색창은 동일 커맨드를 지원하는 축소판 |
| **Bridge (브리지)** | EXT ↔ APP 통신 채널 (Native Messaging 프록시 + 소켓/파이프) |
| 범위 외 창 | 팝업, 앱, DevTools 등 `type != normal` 창은 Topic이 되지 않으며 검색 대상에서도 제외 |

---

## 3. 기능 목록 (요약)

| ID | 기능 | 담당 | 우선순위 |
|---|---|---|---|
| F-01 | Topic(=창) 자동 생성, 이름 지정/변경, 삭제 | EXT, APP | P0 |
| F-02 | 탭을 Topic으로 보내기 / 새 Topic으로 분리 (검색창 커맨드) | EXT, APP | P0 |
| F-03 | 창 안 하위 그룹 (Chrome Tab Group 보조 구조) | EXT | P1 |
| F-04 | 창 ↔ Topic 매핑 유지 (창 생성/닫힘/병합 추적) | EXT | P0 |
| F-05 | 창·탭 이벤트 수집 및 APP 동기화 | EXT, Bridge | P0 |
| F-06 | 런처 표시/숨김 (글로벌 단축키, 트레이) | APP | P0 |
| F-07 | 키워드 검색 (한글 초성/자모 + 영문 퍼지) | APP, EXT | P0 |
| F-08 | 검색 결과 선택 → 해당 탭/창 전면화 | APP, EXT | P0 |
| F-09 | 검색창에서 Topic 창 닫기 / 합치기 (`>close`, `>merge`) | APP, EXT | P1 |
| F-10 | 규칙 자동 귀속: 행동 학습 제안 + 수동 규칙 | EXT | P1 |
| F-11 | Chrome 내부 UI (Popup 검색창 / Omnibox / Side Panel 개요) | EXT | P0 (Popup), P1 (나머지) |
| F-12 | 재시작 후 주제 재연결 (탭 지문) + JSON 내보내기 | APP, EXT | P1 |
| F-13 | 시맨틱 검색 (온디바이스 임베딩, 옵트인) | APP, EXT | P2 |
| F-14 | 자동 주제 제안 (클러스터링 + 레이블) | APP | P2 |
| F-15 | 설정 (단축키, 자동 시작, 테마, 데이터 내보내기) | APP, EXT | P1 |
| F-16 | 다중 Chromium 브라우저 (Edge/Brave) 지원 | Bridge | P2 |

---

## 4. 기능 상세

### F-01 Topic(=창) 자동 생성, 이름 지정/변경, 삭제 (P0)
- **자동 생성**: `windows.onCreated`(type=normal) 시 Topic을 즉시 생성. 임시 이름 규칙: (1) 탭이 1개면 그 탭의 사이트명, (2) 여러 개면 가장 많은 host, (3) 그것도 없으면 "새 주제 N". 임시 이름은 탭 구성이 바뀌면 사용자가 이름을 붙이기 전까지 갱신된다
- **이름 지정/변경**: 검색창 `>rename <이름>` (현재 창) 또는 결과 행에서 이름 편집. 1~50자, 중복 불가(대소문자 무시). 이름을 붙인 순간 임시 이름 갱신은 멈춘다
- **색상**: 선택 사항. 지정 시 Side Panel 배지와 창 안 하위 그룹 기본색에 반영
- **삭제**: 창을 닫으면 Topic도 함께 삭제된다(v0.3). 별도의 삭제 UI는 없다
- **설명(선택)**: 검색 대상에 포함

### F-02 탭을 Topic으로 보내기 / 새 Topic으로 분리 (P0)
- **기본 경로 (검색창)**: 검색창에 `>move <주제>` 또는 `>` 모드에서 주제 이름 선택 + Enter → 현재 활성 탭을 그 Topic Window로 `tabs.move`. 대상은 열린 창의 주제만 제안된다
- **새 Topic으로 분리**: `>new <이름>` → 현재 탭으로 `windows.create({tabId})` → 새 창 = 새 Topic. 여러 탭 선택(highlight) 상태면 선택 탭 전체 이동
- **보조 경로**: 탭 우클릭 컨텍스트 메뉴 "→ 주제로 보내기 ▸ [목록]" / "→ 새 주제로", 단축키(`chrome.commands`)로 "마지막 사용 주제로 보내기"
- **이동 후 포커스**: 기본은 현재 창에 머무름(정리 흐름 유지). `Shift+Enter`는 이동 후 대상 창으로 전환
- 하나의 탭은 항상 정확히 하나의 창(=Topic)에 속한다

### F-03 창 안 하위 그룹 (P1, 보조)
- 사용자가 Chrome UI 또는 Side Panel에서 창 안에 Tab Group을 만들면 EXT는 이를 Topic의 하위 그룹으로 인식·저장한다 (`tabGroups.on*`)
- Topic 색상이 지정되어 있으면 새 하위 그룹의 기본색으로 제안
- 하위 그룹 이름은 검색 대상에 포함
- 재시작 후 재연결(F-12) 시 하위 그룹 이름·색상도 함께 유지
- **EXT는 하위 그룹을 강제 생성하지 않는다** (v0.1의 Topic↔Tab Group 자동 동기화는 폐기)

### F-04 창 ↔ Topic 매핑 유지 (P0)
- `windowId ↔ topicId` 맵을 `storage.session`에 유지, 영속 데이터는 `storage.local`
- `windows.onRemoved` → 해당 Topic을 탭·하위 그룹과 함께 **삭제**(v0.3; 이름 유무 무관)
- 탭이 다른 창으로 옮겨지면(`tabs.onAttached`) 그 탭의 Topic도 대상 창으로 바뀐다
- 창의 마지막 탭이 다른 창으로 옮겨져 창이 사라지는 경우도 `onRemoved`와 동일 처리
- 브라우저 재시작(세션 마커 없음) 시 F-12가 저장돼 있던 Topic과 복원된 창들을 탭 지문으로 대조해 재연결하고, 창이 없는 Topic은 삭제
- 사용자가 Chrome 기본 기능으로 창 이름을 붙여도 EXT는 읽을 수 없으므로(API 미제공) Topic 이름은 EXT가 별도로 관리한다는 점을 온보딩에 안내

### F-05 창·탭 이벤트 수집 및 APP 동기화 (P0)
- EXT 서비스워커가 `windows.onCreated/onRemoved/onFocusChanged`, `tabs.onCreated/onUpdated/onRemoved/onMoved/onAttached/onDetached/onActivated`, `tabGroups.on*`를 구독
- 각 이벤트를 단조 증가 `seq`가 붙은 델타 메시지로 Bridge를 통해 APP에 push
- 연결/재연결 시 APP가 전체 스냅샷을 요청, EXT가 `windows.getAll({populate:true})` 결과 전체를 전송 (full resync)
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
- 검색 대상: **현재 열린** 탭(title, URL host/path), Topic 이름·설명, 하위 그룹 이름
- 매칭:
  - 영문/숫자: 퍼지 매칭 (fzf 스타일, nucleo)
  - 한글: 원문 + 자모 분해 + 초성 3중 색인 → "ㅊㄹ" → "초록", "채ㅌ" → "챗봇" 등 부분 입력 매칭
  - URL은 host를 가중치 높게 (예: "gh" → github.com)
- 랭킹: 매칭 점수 + 최근 활성화(MRU) 가중 + 현재 창 우선. **Topic 이름과 정확히 일치하면 Topic 행이 최상단**
- 결과 행 2종:
  - **Topic 행**: 색상 배지, 이름, 탭 수, 현재 창 표시. Enter → 창 전면화
  - **탭 행**: favicon, 제목, 도메인, 소속 Topic 배지. Enter → 탭 활성화 + 창 전면화
- 모드 접두어:
  - 없음: 통합 검색
  - `#<topic>`: 해당 Topic 안에서만 검색
  - `>`: 커맨드 모드 (`move`, `new`, `rename`, `open`, `close`, `save`)
- 입력은 `input` 이벤트 기준으로 실시간 필터, IME 조합 중 Enter 무시 (`isComposing` 가드)
- 성능 목표: 탭 1,000개 기준 키 입력 → 결과 갱신 10 ms 이내
- EXT 단독(APP 미연결) 시 동일 로직을 MiniSearch + es-hangul로 Popup에서 제공 (F-11)

### F-08 결과 선택 → 탭 / 창 전면화 (P0)
- Enter: 선택된 탭 활성화 + 창 전면화. Topic 행이면 창만 전면화. `Ctrl/⌘+Enter`: 탭 행에서도 소속 창 전체를 앞으로(활성 탭 변경 없이)
- 시퀀스:
  1. APP → Bridge → EXT: `{action:"focus", tabId?, windowId}`
  2. EXT: (`tabs.update(tabId,{active:true})` →) `windows.update(windowId,{focused:true})` → 창 제목 회신
  3. APP: 회신된 제목/HWND로 OS 레벨 활성화
     - Windows: `EnumWindows`로 `Chrome_WidgetWin_1` + 제목 매칭 → `ShowWindow(SW_RESTORE)` → `SetForegroundWindow` (실패 시 `AttachThreadInput` 폴백)
     - macOS: `osascript` `tell application "Google Chrome"` → `set index of window id W to 1` → `activate` (Automation 권한 안내 UI 포함)
  4. 런처 숨김
- 실패 처리: EXT 미연결 시 결과 행에 "Chrome 연결 필요" 배지, Enter 시 연결 안내

### F-09 검색창에서 Topic 창 닫기 / 합치기 (P1)
- `>close [topic]`: 해당(기본: 현재) 주제의 창을 닫는다 (확인 필요). 주제는 창과 함께 사라진다
- `>merge <topic>`: 현재 창의 탭 전부를 대상 Topic 창으로 이동 (빈 창은 Chrome이 닫고 주제는 삭제)

### F-10 규칙 자동 귀속: 행동 학습 제안 + 수동 규칙 (P1)
- **행동 학습 제안 (기본 경로)**: 사용자가 같은 host(또는 host+path 접두어)의 탭을 같은 Topic으로 **2회** 보내면(F-02), 다음 이동 직후 비침투형 배너로 "앞으로 `github.com/MacTechIN/*` 탭을 'ProjectA'로 자동으로 보낼까요? [예 / 아니오 / 다시 묻지 않기]"를 한 번 묻는다. 예 → 규칙 생성
- **규칙 적용**: `tabs.onUpdated`에서 URL 확정 시 규칙 평가 → 첫 매칭 Topic의 창으로 `tabs.move`. 현재 창이 이미 그 Topic이면 아무것도 하지 않음. 규칙의 대상 Topic 창이 닫혀 있으면(주제 삭제됨) 규칙은 비활성 상태로 남고, 같은 이름의 주제가 다시 생기면 재연결
- **되돌리기**: 자동 이동 직후 5초간 "되돌리기" 토스트. 되돌리면 해당 규칙을 1회 무시하고, 3회 되돌리면 규칙 비활성화 제안
- **수동 규칙 (고급)**: Side Panel/Options에서 host 일치, host+path 접두어, 정규식 규칙을 직접 편집. 우선순위는 목록 순서
- 규칙보다 사용자의 직접 이동(F-02)이 항상 우선

### F-11 Chrome 내부 UI (Popup P0 / Omnibox, Side Panel P1)
- **Popup 검색창 (P0)**: 툴바 아이콘 클릭 또는 `chrome.commands` 단축키로 F-07과 동일한 검색·커맨드 UI (MiniSearch). APP 없이도 Chrome이 활성 앱일 때는 `windows.update({focused})`로 창 전환 가능. Chrome이 백그라운드일 때의 제약은 UI에 안내
- **Omnibox (P1)**: 주소창 키워드(기본 `t`) + 스페이스 → 탭/Topic 제안 → 선택 시 전환
- **Side Panel 개요 (P1)**: Topic(창) 목록 → 하위 그룹 → 탭 트리. 드래그로 탭을 다른 Topic으로 이동, Topic 이름/색상 편집, 규칙 편집. 열린 창만 표시. 정리의 **보조** 화면이며 필수 경로가 아니다

### F-12 재시작 후 주제 재연결 + JSON 내보내기 (P1)
- EXT `storage.local`(및 연결 시 APP SQLite)에 열린 Topic → 탭 스냅샷을 유지
- 브라우저 재시작 후(세션 마커 없음) EXT가 Chrome이 복원한 각 창의 탭 지문 집합과 저장돼 있던 Topic의 탭 지문 집합을 대조(Jaccard ≥ 0.5, 1:1 그리디)하여 재연결 → 이름·색상·하위 그룹 유지. 매칭 안 된 Topic은 삭제, 매칭 안 된 창은 새 Topic
- JSON 내보내기/가져오기 (F-15)
- 충돌 규칙: 탭별 `updated_at` last-writer-wins

### F-13 시맨틱 검색 (P2, 옵트인)
- 설정에서 활성화 시 `multilingual-e5-small` int8(약 118 MB) 다운로드 (동의 UI 필수)
- APP: fastembed-rs로 title+URL 임베딩 → sqlite-vec 저장. EXT: offscreen document + transformers.js (동일 모델, 벡터 호환)
- 랭킹: 키워드 결과 우선, 키워드 결과가 없거나 3개 미만일 때 시맨틱 결과를 보강
- 임베딩 계산은 탭 생성/제목 변경 시 백그라운드로, 런처 응답 지연 없음

### F-14 자동 주제 제안 (P2)
- 대상: 한 창에 서로 무관한 탭이 많이 섞였을 때 "이 창을 N개 주제로 나눌까요?"를 제안 (창 = 주제 모델에서의 분리 제안)
- Tier 0: URL host/path 규칙 + 제목 키워드 중첩으로 분리 후보 생성
- Tier 1: F-13 임베딩 기반 agglomerative/HDBSCAN 클러스터링, 레이블은 TF-IDF 상위 단어
- Tier 2 (선택): 데스크톱 로컬 LLM(Qwen2.5-1.5B 등)으로 한국어 레이블 생성. Chrome Prompt API(Gemini Nano)는 한국어 미지원이므로 영문 레이블에만 사용
- 제안은 Side Panel "제안" 탭에 표시, 사용자가 승인해야 실제 창 분리 실행 (자동 적용 없음)

### F-15 설정 (P1)
- 단축키 (런처 열기, 마지막 주제로 보내기), 자동 시작, 런처 위치/테마, 탭 닫힘 시 저장 탭 보존, 빈 창 닫힘 시 Topic 보존, 규칙 자동 복원, 시맨틱 검색 옵트인
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
| 응답 | 단축키 → 런처 표시 100 ms 이내, 검색 갱신 10 ms 이내, Enter → 창 전면화 300 ms 이내, 탭 보내기 200 ms 이내 |
| 규모 | 탭 2,000개, Topic(창) 200개까지 성능 저하 없이 동작 |
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
│    · 창↔Topic 매핑, 이벤트   │         │ (Rust)       │  pipe   │  - SQLite (source of truth)       │
│  - Popup 검색·커맨드         │         └──────────────┘         │  - nucleo 검색 + 한글 자모 색인    │
│  - Omnibox / Side Panel      │                                  │  - OS 창 전면화                   │
│  - storage.local 캐시        │                                  │  - sqlite-vec / 임베딩 (옵션)     │
│  - offscreen (임베딩, 옵션)   │                                  │                                   │
└──────────────────────────────┘                                  └─────────────────────────────────┘
```

### 6.2 데이터 모델 (APP SQLite, source of truth / EXT `storage.local` 캐시 동일 구조)

| 테이블 | 주요 컬럼 |
|---|---|
| `topic` | `id`, `name`, `is_named`(사용자 지정 여부), `color`(nullable), `description`, `status`(스키마 호환용, 항상 `open`), `window_id`(휘발), `browser`, `last_active_at`, `created_at`, `updated_at` |
| `tab` | `id`, `topic_id`(**필수**), `fingerprint`(url+title 해시), `url`, `title`, `favicon`, `chrome_tab_id`(nullable), `subgroup_id`(nullable), `index`, `is_open`, `last_active_at`, `updated_at` |
| `subgroup` | `id`, `topic_id`, `name`, `color`, `chrome_group_id`(nullable, 휘발), `collapsed` |
| `rule` | `id`, `topic_id`, `kind`(host/prefix/regex), `pattern`, `priority`, `source`(`learned`/`manual`), `enabled`, `undo_count` |
| `move_log` | `id`, `host`, `path_prefix`, `topic_id`, `moved_at` — F-10 학습용 (최근 100건 유지) |
| `tab_vec` (옵션) | `tab_id`, `embedding` (sqlite-vec) |
| `setting` | `key`, `value` |

불변 조건: `open` Topic ↔ 일반 창 1:1. 모든 `is_open` 탭은 자기 `chrome_window_id`에 해당하는 Topic의 `topic_id`를 가진다.

EXT `storage.session`은 `windowId ↔ topicId`, `groupId ↔ subgroupId` 등 휘발 매핑과 `seq` 커서를 보관한다.

### 6.3 Bridge 메시지 (초안)

| 방향 | type | payload |
|---|---|---|
| EXT→APP | `hello` | `{extVersion, browser, lastSeq}` |
| APP→EXT | `snapshot_request` | `{}` |
| EXT→APP | `snapshot` | `{page, total, windows[], tabs[], groups[]}` |
| EXT→APP | `delta` | `{seq, event, window/tab/group}` |
| APP→EXT | `focus` | `{windowId, tabId?}` |
| EXT→APP | `focus_result` | `{ok, windowTitle, windowId}` |
| APP→EXT | `move` | `{tabIds[], topicId}` |
| APP→EXT | `new_topic` | `{tabIds[], name?}` |
| APP→EXT | `rename` | `{topicId, name}` |
| APP→EXT | `close` | `{topicId}` |
| APP→EXT | `topics_update` | `{topics[]}` |
| 양방향 | `ping` / `pong` | `{}` |

메시지는 JSON, host→ext 1 MB 제한 준수. 스키마는 `protocol/`에서 확정.

---

## 7. 범위 외 (v1)
- 클라우드 동기화 / 다중 기기 공유
- 페이지 본문 전문 검색 (제목·URL만 색인)
- Firefox, Safari 지원
- 모바일
- 탭 내용 요약, 클라우드 LLM 연동
- 한 창에 여러 Topic을 두는 모델 (창 = 주제 1:1을 유지)

---

## 8. 릴리스 단계

| 단계 | 포함 기능 | 완료 기준 |
|---|---|---|
| **M1 EXT 코어** | F-01, F-02, F-04, F-07(EXT), F-11(Popup) | Chrome만으로: 창이 자동 Topic이 되고, 팝업 검색창에서 탭 찾기 · 주제로 보내기 · 새 주제 만들기 · 이름 바꾸기가 동작 |
| **M2 Bridge + 런처** | F-05, F-06, F-07, F-08 | 글로벌 단축키 → 검색 → 창 전면화가 Windows/macOS 양쪽에서 300 ms 이내 |
| **M3 보조·자동화·세션** | F-03, F-09, F-10, F-11(Omnibox/Side Panel), F-12, F-15 | 하위 그룹, 행동 학습 규칙, 세션 복원, 설정 완비, 서명 배포 |
| **M4 AI(옵션)** | F-13, F-14, F-16 | 옵트인 시맨틱 검색 + 창 분리 제안, Edge/Brave 지원 |

---

## 9. 미결 사항
1. EXT UI 프레임워크 (Solid/Svelte vs React) — APP 웹뷰와 통일 여부 (계획서에서 Solid 잠정)
2. 런처 기본 단축키 충돌 검토 (macOS `⌥+Space`는 일부 런처와 충돌)
3. ~~Topic Window 강제 여부~~ → **v0.2에서 종결: 창 = 주제 1:1 확정**
4. 빈 창(탭 0개)이 닫힐 때 이름 지정 Topic 보존 기본값 (초안: 보존)
5. 인스톨러 형식 (Windows MSI/NSIS, macOS DMG/pkg) 및 Native Host manifest 등록 시점
6. 임시 이름 갱신 빈도 (탭 변경마다 vs 창 포커스 이탈 시) — 깜빡임 방지 관점에서 후자 우선 검토
