# Chrome Web Store 등록 자료 (E12)

## 기본 정보

| 항목 | 값 |
|---|---|
| 이름 | Chrome Tap Manager |
| 카테고리 | 생산성 → 작업 흐름 및 계획 |
| 언어 | 한국어 (기본), 영어 |
| 확장 ID (manifest `key` 고정) | `ddhenmblchfpohdkenlkfiopjgciljhm` |
| 최소 Chrome | 116 |
| 개인정보처리방침 | `store/privacy.md` 내용을 공개 URL(GitHub Pages 또는 저장소 raw 링크)에 게시 후 등록 |

## 짧은 설명 (132자 이내)

- KO: 창 하나가 곧 주제. 검색 한 번으로 그 창을 앞으로. 탭은 "보내기" 하나로 정리.
- EN: One window, one topic. One search brings that window forward. Tidy tabs with a single "send to".

## 상세 설명

**KO**

작업마다 Chrome 창 하나를 씁니다. 이 확장은 그 창에 이름을 붙여 "주제"로 다루고, 검색창에서 제목·주소·한글 초성으로 탭을 찾아 그 탭이 있는 창을 바로 앞으로 가져옵니다.

- 창 = 주제: 창을 열면 자동으로 이름이 붙고(`>rename`으로 변경), 창을 닫으면 주제도 사라집니다. 따로 관리할 목록이 없습니다.
- 검색: Ctrl+Shift+Space(단축키 변경 가능) 또는 주소창 `t` + 스페이스. 한글 초성(예: `ㄱㅇ`)과 오타에 강한 부분열 검색.
- 정리: `>move 주제`, 탭 우클릭 → "주제로 보내기", Ctrl+Shift+M(마지막 사용 주제로). 사이드 패널에서 드래그로 이동.
- 규칙: 같은 사이트를 같은 주제로 두 번 보내면 규칙을 제안. 수락하면 새 탭이 자동으로 그 창으로 갑니다. 언제든 되돌리기.
- 사이드 패널: 주제 → 탭 그룹 → 탭 트리, 이름·색상 편집.
- 백업: 규칙·설정을 JSON으로 내보내기/가져오기.

모든 데이터는 브라우저 안에만 저장되며 어떤 서버로도 전송되지 않습니다.

**EN**

Use one Chrome window per task. This extension names that window as a "topic", and a Spotlight-style search box finds a tab by title, URL or Korean initial consonants and brings its window to the front.

- Window = topic. Windows are auto-named (rename with `>rename`); closing a window removes the topic. Nothing to maintain.
- Search: Ctrl+Shift+Space (configurable) or `t` + space in the address bar. Typo-tolerant subsequence matching.
- Organize: `>move topic`, right-click a tab → "Send to topic", Ctrl+Shift+M (last used topic), or drag in the side panel.
- Rules: send the same site to the same topic twice and the extension proposes a rule; accepted rules route new tabs automatically, always undoable.
- Side panel: topic → tab group → tab tree with name and colour editing.
- Backup: export/import rules and settings as JSON.

All data stays inside the browser. Nothing is sent to any server.

## 권한 근거 (심사용)

| 권한 | 이유 |
|---|---|
| `tabs` | 모든 창의 탭 제목·URL을 읽어 검색 색인을 만들고 창을 앞으로 가져옵니다. 확장의 핵심 기능이며 대체 권한(`activeTab`)으로는 다른 창의 탭을 알 수 없습니다. |
| `storage` | 주제 이름·색상·규칙·설정을 로컬에 저장 (`storage.local`, `storage.session`). |
| `commands` | 검색창 열기, 마지막 주제로 보내기 단축키. |
| `contextMenus` | 탭 우클릭 "주제로 보내기 ▸" 메뉴. |
| `tabGroups` | Chrome 탭 그룹을 읽기 전용으로 사이드 패널 트리에 표시. 그룹을 만들거나 바꾸지 않습니다. |
| `sidePanel` | 주제 트리 사이드 패널. |
| `nativeMessaging` (선택 권한) | 데스크톱 앱(별도 설치)과의 연결. 설정 페이지에서 사용자가 "연결 켜기"를 눌렀을 때만 요청합니다. |
| 호스트 권한 | 없음. 페이지 내용을 읽거나 스크립트를 주입하지 않습니다. |

원격 코드 없음. 콘텐츠 스크립트 없음.

## 스크린샷 (1280×800, 준비 목록)

1. 팝업 검색창: 한글 초성 검색 결과 + 창 이름 배지
2. `>move` 커맨드 자동완성
3. 사이드 패널: 주제 → 그룹 → 탭 트리, 드래그 이동
4. 규칙 제안 배너와 되돌리기 배너
5. 설정 페이지(시작하기 안내)

## 배포 절차

1. `extension/`에서 `pnpm test && pnpm typecheck && pnpm lint`.
2. `pnpm zip` → `.output/chrome-tap-manager-extension-<version>-chrome.zip`.
3. Chrome Web Store 개발자 대시보드 → 새 항목 → zip 업로드 → 위 설명·권한 근거·스크린샷 입력.
4. 스토어는 자체 서명하므로 `keys/chrome-tap-manager.pem`은 업로드하지 않습니다. 단, manifest의 `key`는 그대로 두어야 개발자 모드 로드와 스토어 설치의 ID가 같습니다. 이미 스토어에 항목이 있을 때 `key`가 있는 zip을 올리면 거부되므로 **첫 업로드 후에는 스토어용 빌드에서 `key`를 제거**하고 개발용 빌드에만 남깁니다(`STORE=1 pnpm zip` 참고, wxt.config.ts).
5. 테스터 배포(스토어 미등록): zip을 풀어 "압축해제된 확장 프로그램 로드". `key`가 들어 있으므로 모든 테스터의 확장 ID가 `ddhenmblchfpohdkenlkfiopjgciljhm`으로 같습니다 → 데스크톱 앱의 Native Messaging Host manifest `allowed_origins`에 이 ID 하나만 등록하면 됩니다.
