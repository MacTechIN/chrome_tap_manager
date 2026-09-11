# Chrome_Project_manager 기술 스택 리서치

- 작성일: 2026-09-11
- 기준 문서: `docs/project_definition.md`
- 조사 방법: 4개 리서치 에이전트가 GitHub, Hugging Face, 웹 검색을 병렬로 조사한 결과를 통합 (GitHub star / 최종 push 일자는 2026-09-11 기준)
- 조사 영역
  1. Chrome Extension 스택
  2. 데스크톱 상주(트레이) 앱 + Spotlight형 검색창 스택
  3. Extension ↔ 데스크톱 앱 연동 방식
  4. 검색 / AI (키워드 검색, 한글 처리, 임베딩 모델, 자동 주제 분류)

---

## 0. 요약 (Executive Summary)

| 영역 | 1순위 선택 | 근거 |
|---|---|---|
| Extension 빌드 | **WXT + TypeScript** (+ Solid/Svelte/React) | Vite 기반, MV3 서비스워커·사이드패널 엔트리 지원, 유지보수 가장 활발 |
| Extension 핵심 API | `tabs`, `tabGroups`, `windows`, `storage`, `sidePanel`, `commands`, `nativeMessaging`, (`omnibox`) | 주제별 그룹핑 / 창 분리 / 검색 폴백 모두 표준 API로 가능 |
| 데스크톱 앱 | **Tauri v2** (Rust + 웹 UI) | 설치 파일 5~10 MB, 유휴 메모리 40~60 MB, 글로벌 단축키·트레이·자동시작 1st-party 플러그인, macOS NSPanel 지원 |
| 연동 채널 | **Native Messaging + 프록시 호스트** (stdio → Unix socket / Named pipe) | KeePassXC·Bitwarden·1Password가 쓰는 검증된 패턴, Chrome이 확장 ID 기반 인증 강제, 포트가 서비스워커를 살려 둠 |
| 창 전면화 | Extension이 탭/창 활성화 + 데스크톱 앱이 OS 레벨 포커스 | `chrome.windows.update({focused})` 단독으로는 Chrome이 백그라운드일 때 작업표시줄 깜빡임으로 격하됨 |
| 검색 (Tier 0) | Extension: **MiniSearch + es-hangul** / 데스크톱: **nucleo** | 초성·자모 분해 인덱싱으로 한글·영문 동시 지원, 모델 불필요 |
| 시맨틱 검색 (Tier 1, 옵션) | **multilingual-e5-small** int8 (~118 MB), transformers.js / fastembed-rs | 한국어 포함 다국어 중 Extension에 실을 수 있는 유일한 크기 |
| 벡터 저장 | Extension: IndexedDB + brute-force cosine / 데스크톱: **sqlite-vec** | 탭 수백~수천 개 규모에서는 ANN 인덱스 불필요 |
| 사용하지 않을 것 | CDP `--remote-debugging-port`, SNSS 세션 파일 파싱 (핵심 루프 용도로) | Chrome 136+ 기본 프로필 원격 디버깅 차단, SNSS는 읽기 전용·지연·포맷 불안정 |

---

## 1. Chrome Extension 스택

### 1.1 Manifest V3 관련 API

| API | 최소 버전 / 권한 | 제공 기능 | 주요 제약 |
|---|---|---|---|
| `chrome.tabs` | MV3, `"tabs"` (url/title/favIconUrl 접근) | `query({title,url,groupId,windowId,lastAccessed})`, `group({tabIds, createProperties:{windowId}})`, `ungroup`, `move({windowId,index})` (창 간 이동), `update(id,{active:true})`, `highlight` | 그룹 **생성**은 `tabs.group`에서 담당 ([docs](https://developer.chrome.com/docs/extensions/reference/api/tabs)) |
| `chrome.tabGroups` | Chrome 89, `"tabGroups"` | `get/query/update/move`; `title`, `color`(9색), `collapsed`, `shared`(137+); `onCreated/onUpdated/onMoved/onRemoved` | 직접 생성 불가; `onMoved`는 창 간 이동 시 미발생 ([docs](https://developer.chrome.com/docs/extensions/reference/api/tabGroups)) |
| `chrome.windows` | MV3 | `create({tabId})`로 주제를 별도 창으로 분리, `update(id,{focused:true})`, `drawAttention` | 아래 "창 전면화" 참고 ([docs](https://developer.chrome.com/docs/extensions/reference/api/windows)) |
| `chrome.sessions` | `"sessions"` | `getRecentlyClosed`(최대 25), `getDevices`, `restore` | 커스텀 세션 저장소 아님. 주제 스냅샷은 `storage`에 직접 저장 |
| `chrome.storage` | `"storage"` | `local` 10 MB(`unlimitedStorage`로 해제), `sync` 100 KB, `session` 10 MB 인메모리(102+) | 탭→주제 인덱스는 `local`, 휘발성 검색 인덱스는 `session` ([docs](https://developer.chrome.com/docs/extensions/reference/api/storage)) |
| `chrome.omnibox` | manifest `"omnibox":{"keyword"}` | 주소창 키워드 → `suggest()` / `onInputEntered` | 트레이 앱 미실행 시 Chrome 내부 검색 폴백으로 유용 |
| `chrome.commands` | manifest | `"global": true` 명령은 Chrome이 비활성일 때도 동작 | 글로벌 키는 **Ctrl+Shift+0~9** 권장, 최대 4개, ChromeOS 미지원 |
| `chrome.runtime.connectNative` | `"nativeMessaging"` | 트레이 앱과 stdio 영속 포트 | host→ext ≤ 1 MB, ext→host ≤ 64 MB; Windows 호스트는 `--parent-window=<HWND>` 인자 수신 |
| `chrome.sidePanel` | Chrome 114, `"sidePanel"` | 주제 트리 UI 상주; `open()`(116+)은 사용자 제스처 필요 | |
| `chrome.offscreen` | Chrome 109, `"offscreen"` | 숨은 DOM 문서 (임베딩 모델 실행 등에 활용 가능) | 프로필당 1개, `chrome.runtime`만 접근 가능 |

### 1.2 서비스워커 수명

- 유휴 **30초** 후 종료. 이벤트/확장 API 호출 시 타이머 리셋. 단일 핸들러 5분 초과 시 종료 ([lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)).
- **Native Messaging 포트는 강력한 keep-alive**로 두 타이머를 모두 취소함 (Chrome 105+). WebSocket도 Chrome 116+에서 동일.
- 그래도 재시작에 대비해 `storage.session`에서 인메모리 인덱스를 복구하는 코드를 서비스워커 최상위에 둘 것.

### 1.3 "창 전면화" 제약 (검증됨)

- `windows.update(id,{focused:true})`는 **Chrome이 이미 활성 앱일 때** Chrome 창 간 전환에는 신뢰할 수 있음.
- 다른 앱이 전면일 때 Windows의 foreground-lock 규칙이 적용되어 **작업표시줄 깜빡임**으로 격하되는 경우가 잦음 ([GoogleChrome/developer.chrome.com#6230](https://github.com/GoogleChrome/developer.chrome.com/issues/6230), "not planned"로 종료).
- 원인은 OS: Win32 `SetForegroundWindow`는 호출자가 전면 프로세스이거나 마지막 입력을 받은 경우 등에만 성공 ([MS docs](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setforegroundwindow)).
- **바로 이것이 트레이 앱이 필요한 이유.** 사용자가 Spotlight 창에 입력하는 순간 우리 프로세스가 전면이므로 Chrome HWND에 `SetForegroundWindow`를 합법적으로 호출할 수 있음.
- 권장 시퀀스: 트레이 앱 → (native port) → Extension: `tabs.update(active)` + `windows.update(focused)` → Extension이 `windowId`/창 제목 회신 → 트레이 앱이 OS 레벨에서 Chrome 활성화.

### 1.4 참고할 오픈소스 탭 관리 확장

| 저장소 | 언어/스택 | Stars | 최종 push | 참고 포인트 |
|---|---|---|---|---|
| [babyman/quick-tabs-chrome-extension](https://github.com/babyman/quick-tabs-chrome-extension) | JS, BSD-3 | 1,021 | 2025-09 | MRU 순서 팝업 스위처, 키보드 탐색, 제목/URL 퍼지 매칭. **검색 UX 모델로 최적** |
| [cnwangjie/better-onetab](https://github.com/cnwangjie/better-onetab) | JS(Vue), MIT | 1,753 | 2025-03 | OneTab 스타일 저장/복원, import/export |
| [stefanXO/Tab-Manager-Plus](https://github.com/stefanXO/Tab-Manager-Plus) | TS(React), 라이선스 불명 | 489 | 2024-10 | 멀티 윈도우 오버뷰, 창 간 탭 이동 (참고만) |
| [antonycourtney/tabli](https://github.com/antonycourtney/tabli) | JS/TS(React), MIT | 414 | 2025-09 | 저장된 창 + 라이브 창 통합 뷰. **"주제당 1창" 모델과 일치** |
| [colebemis/tabio](https://github.com/colebemis/tabio) | JS, MIT | 206 | 2021 | 최소 키보드 스위처, 소스 작음 |
| [nitzanpap/auto-tab-groups](https://github.com/nitzanpap/auto-tab-groups) | TS, GPL-3 | 46 | 2026-08 | 규칙 기반 자동 그룹핑 + WebLLM. **가장 가까운 아키텍처 선례** (GPL 주의) |
| [semihsezer/TabGroupMaestro](https://github.com/semihsezer/TabGroupMaestro) | Vue, Apache-2 | 4 | 2026-08 | 그룹명 검색 |
| [philc/vimium](https://github.com/philc/vimium) | JS, MIT | 26.9k | 2026-07 | `T` 탭 검색 vomnibar — 성숙한 퍼지 랭킹 + IME 안전 입력 처리 |

비오픈소스: OneTab, Tabs Outliner, Session Buddy, Toby, Workona, Cluster. Chrome 내장 Tab Search(Ctrl/⌘+Shift+A)가 넘어야 할 기준선.

### 1.5 빌드 툴

| 도구 | Stars | 최종 push | 비고 |
|---|---|---|---|
| [WXT](https://github.com/wxt-dev/wxt) | 10.5k | 2026-09-07 | Vite 기반, 파일 기반 엔트리포인트, MV2/MV3 + Chrome/Firefox/Safari, `storage` 래퍼 내장, 프레임워크 무관 |
| [Plasmo](https://github.com/PlasmoHQ/plasmo) | 13.1k | 2026-09-10 | Parcel 기반, React 중심, 빌드 느림, 유지보수 우려 반복 제기 |
| [CRXJS](https://github.com/crxjs/chrome-extension-tools) | 4.2k | 2026-09-10 | Vite 플러그인, content script HMR 우수, 2025-06 v2.0 정식 |
| Vanilla + esbuild | — | — | 소규모라면 가능하나 manifest/리로드 수작업 |

**선택: WXT + TypeScript.** 2순위 CRXJS. 신규 프로젝트에 Plasmo는 비추천.

### 1.6 한글 IME 주의사항

- Chrome에서 한글 조합 중 Enter를 누르면 `keydown`이 **2번** 발생 (`keyCode 229` / `isComposing === true` 후 실제 Enter). 단순 "Enter → 탭 열기" 핸들러는 두 번 실행되거나 잘못된 결과를 엶 ([witch.work](https://witch.work/en/posts/fix-input-double-enter-issue)).
- 규칙:
  - `if (e.key === 'Enter' && !e.nativeEvent.isComposing && e.keyCode !== 229) submit()` (React는 `nativeEvent` 사용)
  - `compositionstart/end` 추적, 조합 중 Esc/화살표 무시
  - 검색은 `keydown`이 아닌 `input` 이벤트로 (자모 단위로 실시간 필터)
  - `String.normalize('NFC')` 정규화, 초성 검색 지원
- Windows MS 한국어 IME와 macOS 두벌식 양쪽에서 테스트 필수.

---

## 2. 데스크톱 상주(트레이) 앱 + Spotlight형 검색창

### 2.1 프레임워크 비교

| | Tauri v2 | Electron | Wails v3 (Go) | Flutter desktop | Neutralino | Native (SwiftUI + WinUI) |
|---|---|---|---|---|---|---|
| Stars | [tauri](https://github.com/tauri-apps/tauri) 111k | [electron](https://github.com/electron/electron) 123k | [wails](https://github.com/wailsapp/wails) 36k, v3 **alpha** | 179k | 8.6k | — |
| 번들 크기 | 3~10 MB | 120~200 MB | ~15 MB | 15~25 MB | 수 MB | 최소 (코드베이스 2개) |
| 유휴 RAM | 30~80 MB (Windows WebView2는 Chromium이라 격차 축소) | 150~300 MB | Tauri 유사 | ~90 MB | 낮음 | 최저 |
| 글로벌 단축키 | [tauri-plugin-global-shortcut](https://v2.tauri.app/plugin/global-shortcut/) | 내장 `globalShortcut` | v3 내장 | hotkey_manager (활동 적음) | **없음** | RegisterHotKey / Carbon |
| Always-on-top / 프레임리스 / 투명 | 가능; macOS는 [tauri-nspanel](https://github.com/ahkohd/tauri-nspanel) (418★)로 비활성화 NSPanel | 가능 | 가능 (Windows 프레임리스 이슈 있음) | window_manager | Windows 투명 **불가** | 완전 제어 |
| 트레이 | 내장 + `ActivationPolicy::Accessory`로 Dock 아이콘 숨김 | 내장 `Tray` | v3 내장 | tray_manager | 제한적/버그 | 네이티브 |
| 자동 시작 | [tauri-plugin-autostart](https://v2.tauri.app/plugin/autostart/) | `app.setLoginItemSettings` | 수동 | 수동 | 수동 | SMAppService / 레지스트리 |
| 서명/공증 | CLI 자동 공증 | 성숙 (electron-builder) | 수동 | 수동 | 수동 | Xcode + signtool |

**판단:** Electron이 가장 검증됐지만 "램 상주" 목적에는 부적합. Wails v3는 기능은 맞지만 alpha. Neutralino는 단축키·Windows 투명 미지원. **Tauri v2**가 모든 요구사항을 1st-party 플러그인으로 충족하고 런처 선례(Kunkun)가 있어 선택. 폴백은 Electron.

### 2.2 참고할 오픈소스 런처

| 프로젝트 | 프레임워크 | Stars / push | 참고 포인트 |
|---|---|---|---|
| [Flow Launcher](https://github.com/Flow-Launcher/Flow.Launcher) | C#/WPF (Win) | 15.5k / 2026-09-10 | JSON-RPC 플러그인 프로토콜; `WindowWalker` 플러그인이 "제목으로 창 찾아 전환" 그 자체 |
| [Wox](https://github.com/Wox-launcher/Wox) | Go + Flutter | 27.3k / 2026-09-10 | 크로스플랫폼 핫키/창 표시 코드 |
| [PowerToys Run](https://github.com/microsoft/PowerToys) | C#/WinUI | 138k | `FuzzyStringMatcher`, Window Walker |
| [ueli](https://github.com/oliverschwendener/ueli) | Electron + TS | 4.6k / 2026-09-10 | **형태가 가장 유사**: 트레이 앱, 핫키 show/hide UX |
| [sol](https://github.com/ospfranco/sol) | Swift + RN (macOS) | 3.1k / 2026-09-06 | <100 ms 오픈; NSPanel show/hide Swift 구현 |
| [Kunkun](https://github.com/kunkunsh/kunkun) | **Tauri v2 + Svelte** | 1.3k / 2026-02-10 | **Tauri 런처 직접 템플릿**: 트레이, 핫키, NSPanel |
| [tauri-macos-spotlight-example](https://github.com/ahkohd/tauri-macos-spotlight-example) | Tauri | 294 / 2025-09 | 최소 Spotlight 창 예제 (v2 브랜치) |
| [Vicinae](https://github.com/vicinaehq/vicinae) | C++/Qt | 9.5k | Raycast 호환 확장 API |
| [raycast/extensions](https://github.com/raycast/extensions) | TS | 7.7k | UI/API 컨벤션 (List, ActionPanel) |

### 2.3 특정 Chrome 창을 전면으로 가져오기

**Windows**
- Chrome 최상위 창: 클래스 `Chrome_WidgetWin_1`, 제목 `"<활성 탭 제목> - Google Chrome"`. `EnumWindows` + `GetClassNameW` + `GetWindowTextW`로 열거. 창 제목에는 **활성 탭 제목만** 들어가므로 Extension이 먼저 탭을 활성화하고 `windowId → title`을 native messaging으로 알려줘야 함.
- `SetForegroundWindow` 거부 시 우회: `AttachThreadInput` 트릭 또는 ALT 키 합성 입력 ([gist](https://gist.github.com/Aetopia/1581b40f00cc0cadc93a0e8ccb65dc8c)). 최소화 상태면 `ShowWindow(SW_RESTORE)`.
- 런처가 Enter 시점에 전면이므로 보통 트릭 없이 성공하지만 폴백 유지.
- 크레이트: [`windows`](https://crates.io/crates/windows) 0.62 (windows-rs 12.7k★), [`x-win`](https://crates.io/crates/x-win) 5.8 (창 목록, 크로스플랫폼). Node: `node-window-manager` (2022 이후 정체), `get-windows` (읽기 전용).

**macOS**
- 가장 단순: `osascript` → `tell application "Google Chrome" to set active tab index of window id W to T; set index of window id W to 1; activate`. **Automation** TCC 권한 필요; hardened runtime 앱은 `NSAppleEventsUsageDescription` + `com.apple.security.automation.apple-events` entitlement 필수 (없으면 -1743).
- Accessibility 경로: `AXUIElement` → `kAXWindowsAttribute` → `kAXTitleAttribute` 매칭 → `AXRaise` + `NSRunningApplication.activate`. **Accessibility** 권한 필요. 크레이트: `axuielement`, `objc2-app-kit`.
- `CGWindowListCopyWindowInfo`의 `kCGWindowName`은 **Screen Recording** 권한 필요 → 회피. Extension이 창 id/제목을 제공하므로 AppleScript 경로면 Automation 권한만으로 충분.

### 2.4 글로벌 단축키 라이브러리

| 프레임워크 | 라이브러리 | 비고 |
|---|---|---|
| Tauri v2 | tauri-plugin-global-shortcut 2.3.2 ([global-hotkey](https://github.com/tauri-apps/global-hotkey) 크레이트 기반) | 이미 점유된 키는 조용히 실패 → Rust `setup`에서 등록하고 결과 확인 |
| Electron | `globalShortcut` | 내장 |
| Wails v3 | `app.GlobalShortcut` | |
| Native | Win32 `RegisterHotKey`; macOS Carbon `RegisterEventHotKey` 또는 `NSEvent.addGlobalMonitorForEvents`(Accessibility 필요) | |

---

## 3. Extension ↔ 데스크톱 앱 연동

### 3.1 Chrome Native Messaging (1순위)

**등록** ([공식 문서](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging))
- Windows: 레지스트리 `HKCU\SOFTWARE\Google\Chrome\NativeMessagingHosts\<host.name>` (관리자 불필요, 권장) 또는 `HKLM\...`. 기본값 = manifest JSON 절대경로. Windows에서만 manifest의 `path`가 상대경로 허용.
- macOS: `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/<host.name>.json` (사용자) 또는 `/Library/Google/Chrome/NativeMessagingHosts/` (시스템). Chromium/Brave/Edge는 각자 디렉터리가 있어 인스톨러가 여러 곳에 써야 함.
- manifest: `name`, `description`, `path`, `type: "stdio"`, `allowed_origins` (`chrome-extension://<id>/`, 와일드카드 불가). **이것이 유일한 인증 수단**이므로 manifest에 고정 `key`로 확장 ID를 고정할 것.
- 기업 정책 `NativeMessagingUserLevelHosts=0`은 사용자 레벨 호스트를 차단 → 필요 시 HKLM 폴백.

**프로토콜**: 32bit 길이 prefix(네이티브 바이트 오더) + UTF-8 JSON. host→ext **1 MB**, ext→host 64 MiB. stdout은 프로토콜 전용(로그는 stderr). Windows에서 stdio를 `O_BINARY`로.

**수명**: `connectNative()`는 포트당 호스트 프로세스 1개를 띄우고 포트 종료까지 유지. 열린 포트는 MV3 서비스워커를 살려 둠 (Chrome 105+).

**이미 실행 중인 트레이 앱과 통신**: Chrome은 항상 자체적으로 호스트 프로세스를 띄우므로, stdio 프레임을 Unix domain socket(macOS)/Named pipe(Windows)로 중계만 하는 **얇은 프록시 호스트**를 두는 것이 표준 패턴.
- [keepassxc-proxy-rust](https://github.com/varjolintu/keepassxc-proxy-rust) (97★, 2025-05): 소켓 `/tmp/org.keepassxc.KeePassXC.BrowserServer`, 파이프 `\\.\pipe\keepassxc\<user>\kpxc_server`
- Bitwarden: `desktop_proxy` → socket/pipe → Electron ([아키텍처 문서](https://contributing.bitwarden.com/architecture/deep-dives/ipc/))
- [browserpass-native](https://github.com/browserpass/browserpass-native) (442★, 2025-09): Go 호스트, Windows 인스톨러가 레지스트리 작성 + Homebrew formula. **패키징 참고**
- 1Password: `com.1password.1password` 호스트, 동일 패턴

**라이브러리**
- Rust: [neon64/chrome-native-messaging](https://github.com/neon64/chrome-native-messaging) (34★), [`native_messaging`](https://lib.rs/crates/native_messaging) — 둘 다 ~100줄. `serde_json` + `byteorder`로 직접 작성해도 무방.
- Node: [jdiamond/chrome-native-messaging](https://github.com/jdiamond/chrome-native-messaging) (139★), [simov/native-messaging](https://github.com/simov/native-messaging) (53★)
- Go: [qrtz/nativemessaging](https://github.com/qrtz/nativemessaging)
- 다중 런타임 예제: [guest271314/NativeMessagingHosts](https://github.com/guest271314/NativeMessagingHosts) (2026-07)

### 3.2 대안: localhost WebSocket

- 서비스워커가 `ws://127.0.0.1:<port>`로 트레이 앱에 접속 ([Chrome 문서](https://developer.chrome.com/docs/extensions/how-to/web-platform/websockets)). Chrome 116+에서 WebSocket 트래픽이 30초 유휴 타이머를 리셋하므로 20초 ping으로 유지 (`minimum_chrome_version: "116"`).
- 장점: 채널 자체에는 인스톨러/레지스트리 불필요, 양방향 push, 디버깅 쉬움.
- 단점: localhost의 **어떤 프로세스/웹페이지도 접속 가능** → `Origin === chrome-extension://<id>` 검사 + 공유 토큰 + loopback 바인딩 필수. 포트 충돌, 방화벽/AV 오탐, 재접속 버그가 주요 고충.
- `externally_connectable`은 웹페이지/다른 확장 → 확장 방향만 가능. 네이티브 프로세스는 사용 불가.

### 3.3 대안: Chrome DevTools Protocol (확장 없이)

- `--remote-debugging-port=9222` → `/json/list`, `Target.activateTarget`, Playwright `connectOverCDP()`. Rust: [chromiumoxide](https://github.com/mattsse/chromiumoxide) (1,381★, 2026-04).
- **차단 요인 (검증됨)**: Google [2025-03 공지](https://developer.chrome.com/blog/remote-debugging-port)에 따라 **Chrome 136부터** 기본 `user-data-dir`에서는 `--remote-debugging-port`가 무시됨. 별도 프로필 필수 → 사용자 실제 탭 관리 불가. 항상 플래그로 Chrome을 실행해야 하는 문제도 있음.
- 결론: 개발/테스트 하네스 용도로만.

### 3.4 대안: SNSS 세션 파일 읽기

- Chrome은 `Sessions/Session_<ts>`, `Tabs_<ts>`를 비공개 SNSS pickle 포맷으로 기록. 파서: [lemnos/chrome-session-dump](https://github.com/lemnos/chrome-session-dump) (Go, 124★), [thanadolps/snss](https://github.com/thanadolps/snss) (Rust, 2025-12), python-snss, SNSS_Reader(C#).
- 읽기 전용, 지연 기록(수 초 lag, Windows 파일 잠금), 버전 업 시 파서 깨짐, 포커스/열기 불가.
- 결론: 확장이 꺼져 있을 때 "마지막에 열려 있던 탭" 폴백 또는 최초 import 용도로만.

### 3.5 비교표

| | Native Messaging + 프록시 | localhost WebSocket | CDP | SNSS 파일 |
|---|---|---|---|---|
| 확장 필요 | 예 | 예 | 아니오 | 아니오 |
| 인스톨러 단계 | 예 (레지스트리/JSON manifest) | 채널은 불필요 | Chrome 136+ 비기본 프로필 + 플래그 실행 | 아니오 |
| 탭 열거 | `chrome.tabs` | `chrome.tabs` | `/json/list` | 가능 (지연, 읽기 전용) |
| 창 포커스/탭 열기 | `windows.update`, `tabs.create` | 동일 | `Target.activateTarget` | 불가 |
| 인증 | `allowed_origins` (Chrome 강제) | Origin + 토큰 직접 검사 | 없음 | 파일시스템 |
| SW keep-alive | 포트가 유지 (105+) | 20초 ping 필요 (116+) | — | — |
| 메시지 크기 | 1 MB (host→ext) | 무제한 | 무제한 | — |
| 선례 | KeePassXC, Bitwarden, 1Password, browserpass | 취미 프로젝트 다수 | Playwright/Puppeteer | 포렌식 도구 |

### 3.6 데이터 모델 / 동기화

- **데스크톱 SQLite를 source of truth**로 (`topic → [url/title/tabId]`). Chrome이 꺼져 있어도 존재해야 하고 Spotlight 인덱스를 제공하기 때문.
- Extension은 `chrome.storage.local`에 **캐시** + 라이브 `tabId ↔ windowId` 상태 보유.
- 동기화: Extension이 탭 이벤트(`onCreated/onUpdated/onRemoved/onMoved/onAttached`)를 단조 증가 `seq`와 함께 델타로 push; 데스크톱은 연결/재연결 시 권위 있는 스냅샷으로 응답(전체 재동기화) → 충돌 케이스 대부분 제거.
- 실제 충돌(오프라인에서 양쪽 UI가 같은 탭을 재태깅)은 탭별 `updated_at` last-writer-wins. Chrome `tabId`는 재시작 시 리셋되므로 탭 identity는 URL+title 지문으로.
- 창 안에서는 `chrome.tabGroups`로 주제를 미러링; `chrome.windows.create({tabIds})` / `chrome.tabs.move`로 "주제당 1창" 구현.

---

## 4. 검색 / AI

### 4.1 키워드·퍼지 검색 라이브러리

**JavaScript (Extension)**

| 라이브러리 | Stars | 라이선스 | 크기 | 한글 적합성 |
|---|---|---|---|---|
| [MiniSearch](https://github.com/lucaong/minisearch) | ~6.1k | MIT | ~8 KB gz | 역색인, prefix+fuzzy, 필드 부스팅, 커스텀 `tokenize`/`processTerm` 훅 → **자모 분해 토크나이저 꽂기 가장 쉬움. 1순위** |
| [Fuse.js](https://github.com/krisk/fuse) | ~20.4k | Apache-2.0 | ~4 KB gz | Bitap 퍼지; 한글은 음절 단위로만 매칭 (사전 분해 필요) |
| [FlexSearch](https://github.com/nextapps-de/flexsearch) | ~13.7k | Apache-2.0 | 6~10 KB | 대규모에 가장 빠름; `cjk` 토크나이저 있음; 탭 규모에는 과함 |
| [Orama](https://github.com/oramasearch/orama) | ~10.5k | Apache-2.0 | <2 KB core | 풀텍스트+벡터+하이브리드 한 라이브러리; `korean` 토크나이저 옵션. 시맨틱 확장 시 유력 |
| [uFuzzy](https://github.com/leeoniya/uFuzzy) | ~3k | MIT | 7.5 KB | 라틴 최적화; 자모 이해 못함 |

**Rust (데스크톱)**

| 크레이트 | Stars | 라이선스 | 비고 |
|---|---|---|---|
| [nucleo](https://github.com/helix-editor/nucleo) | ~1.5k | MPL-2.0 | Helix 에디터의 fzf형 매처, skim 대비 ~6배 빠름, 비ASCII grapheme 정확. **Spotlight 창에 최적** |
| [tantivy](https://github.com/quickwit-oss/tantivy) | ~16.1k | MIT | Lucene급 풀텍스트; 한국어는 `lindera-ko-dic`. 페이지 본문까지 색인할 때만 |

**한글 처리**

| 라이브러리 | Stars | 라이선스 | 용도 |
|---|---|---|---|
| [es-hangul](https://github.com/toss/es-hangul) (Toss) | ~1.9k | MIT | `getChoseong()`, `disassemble()`, `assemble()`. **권장** |
| [Hangul.js](https://github.com/e-/Hangul.js) | ~711 | MIT | `disassemble`, `search`, `rangeSearch` (키 입력 단위 하이라이트). README가 es-hangul 권유 |
| [korean-regexp](https://www.npmjs.com/package/korean-regexp) | 소규모 | MIT | 부분 입력(초성 + 미완성 음절)에서 RegExp 생성 → 점진 타이핑에 적합 |

패턴: 탭마다 원문 title/URL, 자모 분해 문자열, 초성 문자열 3가지를 색인해 MiniSearch/nucleo에 공급. Rust 쪽 자모 분해는 ~30줄 (`0xAC00 + (초×21 + 중)×28 + 종`)로 크레이트 불필요.

### 4.2 온디바이스 임베딩 모델 (다국어, 한국어 포함)

| 모델 | 파라미터 | 차원 | ONNX 디스크 크기 | 라이선스 | 한국어 품질 | 런타임 |
|---|---|---|---|---|---|---|
| [intfloat/multilingual-e5-small](https://huggingface.co/intfloat/multilingual-e5-small) / [Xenova ONNX](https://huggingface.co/Xenova/multilingual-e5-small/tree/main/onnx) | 118M | 384 | fp32 470 MB, fp16 235 MB, **int8 118 MB**, q4f16 205 MB | MIT | Korean-MTEB retrieval NDCG@10 ≈ 0.671 | transformers.js, fastembed-rs, ort |
| [dragonkue/multilingual-e5-small-ko](https://huggingface.co/dragonkue/multilingual-e5-small-ko) | 118M | 384 | 동일 (ONNX 직접 변환 필요) | Apache-2.0 | **0.689** (7개 한국어 retrieval 평균). 크기 대비 최고 | ort |
| [paraphrase-multilingual-MiniLM-L12-v2](https://huggingface.co/sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2) / [Xenova](https://huggingface.co/Xenova/paraphrase-multilingual-MiniLM-L12-v2) | 118M | 384 | int8 ≈ 118 MB | Apache-2.0 | STS 튜닝, retrieval은 e5보다 약함; 128 토큰 제한 | transformers.js |
| [BAAI/bge-m3](https://huggingface.co/BAAI/bge-m3) | 568M | 1024 | fp32 2.2 GB, int8 570 MB | MIT | 강함 (Korean-MTEB 79.3), 확장에는 과중 | 데스크톱만 |
| [nlpai-lab/KURE-v1](https://huggingface.co/nlpai-lab/KURE-v1) | 568M | 1024 | 2.2 GB | MIT | Korean-MTEB v2 5위, 80.76 | 데스크톱만 |
| [dragonkue/BGE-m3-ko](https://huggingface.co/dragonkue/BGE-m3-ko), [upskyy/bge-m3-korean](https://huggingface.co/upskyy/bge-m3-korean) | 568M | 1024 | 2.2 GB | Apache-2.0 | KURE-v1 직하 | 데스크톱만 |
| jhgan/ko-sroberta-multitask, BM-K/KoSimCSE-roberta | ~110M | 768 | 440 MB | — | 한국어 전용(영문 X), 구형 → 제외 | |
| [Xenova/bge-small-en-v1.5](https://huggingface.co/Xenova/bge-small-en-v1.5) | 33M | 384 | int8 32 MB | MIT | 영어 전용 → 불가 | |

- 한국어 리더보드: [OnAnd0n/ko-embedding-leaderboard](https://github.com/OnAnd0n/ko-embedding-leaderboard)
- Rust 추론: [fastembed-rs](https://github.com/anush008/fastembed-rs)가 `MultilingualE5Small`, `BGEM3` 기본 제공
- 브라우저: [transformers.js](https://github.com/huggingface/transformers.js) (~16.3k★, v4.x, `device:'webgpu'`, `dtype:'q8'`)

**결론:** `multilingual-e5-small`(또는 `-ko` 파인튜닝) int8 ≈ 118 MB가 Extension에 실을 수 있는 유일한 다국어 모델. bge-m3/KURE-v1은 데스크톱 전용.

### 4.3 자동 주제 그룹핑

**접근법**
- **임베딩 + 클러스터링 (권장)**: title+URL 임베딩 → HDBSCAN 또는 코사인 거리 agglomerative. JS: [hdbscan-ts](https://github.com/GeLi2001/hdbscan-ts), density-clustering. 탭 300개 미만이면 brute-force agglomerative ~50줄로 충분. Rust: `linfa-clustering`, `kodama`.
- Zero-shot 분류 (NLI 모델): 저렴하지만 영어 레이블 고정, 개방형 한국어 주제에 부적합.
- **도메인/규칙 휴리스틱 (Tier 0)**: URL host/path, 제목 키워드 (github.com → Dev, youtube.com → Media). 실사용 대부분을 즉시 커버.

**클러스터 레이블링용 소형 LLM**

| 옵션 | 상태 (2026-09) | 비고 |
|---|---|---|
| [Chrome Prompt API / Gemini Nano](https://developer.chrome.com/docs/ai/prompt-api) | **Chrome 138+ 확장에서 stable** | JSON-schema `responseConstraint`; >4 GB VRAM, 22 GB 디스크. **공식 지원 언어 en/ja/es/de/fr — 한국어 미지원** |
| [WebLLM](https://github.com/mlc-ai/web-llm) | ~19.1k★ | WebGPU; Qwen2.5 0.5B~3B, 공식 chrome-extension 예제; 360 MB+ 다운로드 |
| transformers.js + [Qwen2.5-0.5B-Instruct](https://huggingface.co/onnx-community/Qwen2.5-0.5B-Instruct) | 동작 | q4 ≈ 400~500 MB; Qwen 한국어 준수 |
| 데스크톱 llama.cpp / Ollama (Qwen2.5-1.5B, Gemma-3-1B) | 성숙 | 한국어 레이블 품질 최고; 트레이 앱에서 실행 후 확장으로 push |

**기존 프로젝트**
- [nitzanpap/auto-tab-groups](https://github.com/nitzanpap/auto-tab-groups) — 도메인 규칙 + WebLLM. 가장 가까운 선례 (GPL-3)
- [florianlanx/tabpilot](https://github.com/florianlanx/tabpilot) — 155+ 규칙 + 옵션 클라우드 LLM
- ai-group-tabs, tab-organizer, ai-tab-grouper, chrome-auto-group — 클라우드 LLM 기반
- [tomzx/chrome-tabs-clustering-extension](https://github.com/tomzx/chrome-tabs-clustering-extension) — 고전 클러스터링, LLM 없음
- Chrome 내장 "Organize Similar Tabs" (탭 우클릭) + Canary의 Gemini 그룹 기능 — 확장 API로 노출되지 않으므로 의존 불가, 경쟁 벤치마크

### 4.4 로컬 벡터 저장

| 위치 | 옵션 | Stars / 라이선스 | 비고 |
|---|---|---|---|
| Extension | IndexedDB + brute-force cosine | — | 384차원 수천 개까지 `Float32Array` 스캔 <5 ms. **의존성 0, 권장** |
| Extension | [Orama](https://github.com/oramasearch/orama) | 10.5k / Apache-2.0 | BM25 + 벡터 하이브리드 단일 인덱스 |
| Extension | [voy](https://github.com/tantaraio/voy) | ~900 / MIT | Rust/WASM k-d tree 75 KB |
| Extension | [client-vector-search](https://github.com/yusufhilmi/client-vector-search) | ~200 / MIT | transformers.js + IndexedDB 번들 |
| 데스크톱 (Rust) | [sqlite-vec](https://github.com/asg017/sqlite-vec) | 8.1k / Apache·MIT | C 파일 1개, `rusqlite`와 동작. 탭 DB와 같은 파일에 저장. **권장** |
| 데스크톱 | [usearch](https://github.com/unum-cloud/USearch) | ~4.2k / Apache-2.0 | HNSW, mmap |
| 데스크톱 | [LanceDB](https://github.com/lancedb/lancedb) | ~11k / Apache-2.0 | 바이너리 무겁고 Rust API 불안정 |

### 4.5 단계별 권장안

**Tier 0 — 키워드 우선 (먼저 출시, 모델 없음)**
- Extension: **MiniSearch** + **es-hangul** 커스텀 토크나이저 (원문 + 자모 + 초성). 필드: title, URL host/path, 그룹명.
- 데스크톱: **nucleo** + 30줄 자모 분해 → "ㅊㄹ"이 "초록"에 매칭.
- 그룹핑: URL host/path 규칙 + 제목 키워드 중첩.

**Tier 1 — 시맨틱 (옵션, 사용자 동의 후 다운로드)**
- 모델: **multilingual-e5-small** int8 (~118 MB). 확장은 transformers.js(offscreen document, WebGPU), 데스크톱은 fastembed-rs/ort. **양쪽 같은 모델**로 벡터 호환.
- 저장: 확장 IndexedDB brute-force / 데스크톱 sqlite-vec.
- 그룹핑: Tier 0 규칙으로 seed 후 agglomerative/HDBSCAN. 레이블은 기본 TF-IDF 상위 단어.

**Tier 2 — LLM 레이블 (옵션)**
- 영어 레이블: Chrome Prompt API (Gemini Nano). 한국어 레이블: 데스크톱 llama.cpp/Ollama + Qwen2.5-1.5B → 확장으로 push.

하이브리드 랭킹: 키워드 점수 우선, 시맨틱은 키워드 결과가 비었을 때 폴백/부스트 → Spotlight 창 응답 10 ms 이하 유지.

---

## 5. 통합 아키텍처 제안

```
┌──────────────────────────────┐        native messaging          ┌─────────────────────────────────┐
│  Chrome Extension (WXT/TS)   │  stdio  ┌──────────────┐ socket/ │  Tray App (Tauri v2, Rust)       │
│  - MV3 service worker        │◄───────►│ proxy host   │◄───────►│  - Spotlight window (NSPanel /   │
│    · tabs/tabGroups/windows  │         │ (Rust ~150줄)│  pipe   │    always-on-top, global hotkey)  │
│    · storage.local 캐시      │         └──────────────┘         │  - SQLite (source of truth)       │
│    · MiniSearch + es-hangul  │                                  │    + sqlite-vec (옵션)            │
│  - Side panel (주제 트리)     │                                  │  - nucleo fuzzy matcher           │
│  - Popup / omnibox (폴백 검색)│                                  │  - OS focus: SetForegroundWindow /│
│  - offscreen (임베딩, 옵션)   │                                  │    osascript "Google Chrome"      │
└──────────────────────────────┘                                  └─────────────────────────────────┘
```

**핵심 흐름 (검색 → 창 전면화)**
1. 사용자가 글로벌 단축키로 Spotlight 창 오픈, 키워드 입력
2. 트레이 앱이 nucleo로 로컬 SQLite 인덱스 검색 (한글 자모/초성 포함)
3. Enter → native port로 Extension에 `{action:"focus", tabId, windowId}` 전송
4. Extension: `tabs.update(active)` + `windows.update(focused)` → 창 제목 회신
5. 트레이 앱: 회신된 제목/HWND로 OS 레벨 Chrome 활성화 (트레이 앱이 전면이므로 허용됨)

**핵심 흐름 (주제 그룹핑)**
1. Extension이 탭 이벤트 델타를 seq와 함께 트레이 앱으로 push
2. 트레이 앱이 규칙(Tier 0) → 임베딩 클러스터(Tier 1)로 주제 제안
3. 사용자가 확정하면 Extension이 `tabs.group` + `tabGroups.update({title,color})`, 필요 시 `windows.create` + `tabs.move`로 주제당 1창 구성

---

## 6. 결정 필요 사항 / 리스크

| 항목 | 내용 |
|---|---|
| Extension UI 프레임워크 | Solid/Svelte(경량) vs React(트레이 앱 웹뷰와 컴포넌트 공유) — 트레이 앱 UI와 통일 권장 |
| macOS 권한 | AppleScript 경로: Automation 권한만. AX 경로: Accessibility 권한. Screen Recording은 회피 |
| 코드 서명 | Windows: signtool + 레지스트리 인스톨러. macOS: 공증 + apple-events entitlement |
| 확장 ID 고정 | `allowed_origins` 인증이 확장 ID에 의존 → manifest `key`로 고정 후 스토어 배포 |
| Chrome 외 브라우저 | Edge/Brave/Chromium은 native host manifest 경로만 추가하면 동일 동작 |
| Firefox/Safari | WXT는 지원하지만 native messaging 경로·권한이 다름 → 후순위 |
| 모델 다운로드 | Tier 1 이상은 118 MB+ 다운로드 → 옵트인 UX 필수 |
| Gemini Nano 한국어 | 공식 미지원 → 한국어 레이블은 데스크톱 로컬 LLM으로 |
