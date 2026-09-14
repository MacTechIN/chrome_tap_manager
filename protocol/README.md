# protocol

Extension ↔ Desktop 간 Bridge 메시지 **JSON Schema**. 세 앱(`extension/`, `desktop/`, `bridge/`)이 공유하는 유일한 계약이다.

- 파일: `bridge.schema.json` (JSON Schema draft-07). 버전: `VERSION`
- 각 앱은 이 스키마에서 자기 언어의 타입을 **각자 생성/작성**한다. 앱 간 코드 import는 금지.
  - extension: `extension/src/bridge/protocol.ts` (수기 작성, 테스트가 스키마의 메시지 목록과 대조)
- 스키마 변경 시 `VERSION`을 올리고 루트 `history.md`에 기록한다.

## v0.1 메시지

| 방향 | type | 요약 |
|---|---|---|
| EXT→APP | `hello` | 포트 연결 직후. `protocolVersion`, `extVersion`, `browser`, `lastSeq` |
| APP→EXT | `snapshot_request` | 전체 재동기화 요청 |
| EXT→APP | `snapshot` | 전체 상태를 탭 200개 단위 페이지로 전송(`page`/`pages`, 마지막 페이지에 `seq`) |
| EXT→APP | `delta` | 라이브 이벤트 1건 + 단조 `seq`. APP는 `seq` 공백을 보면 `snapshot_request` |
| APP→EXT | `focus` | 창(선택적으로 탭) 활성화 → EXT가 `focus_result`(창 제목 포함) 회신 → APP가 OS 레벨 전면화 |
| EXT→APP | `focus_result` | `ok`, `windowId`, `windowTitle`, `error` |
| APP→EXT | `move` / `new_topic` / `rename` / `close` | 정리 명령. 응답은 `topics_update`(같은 `requestId`, `ok`) |
| EXT→APP | `topics_update` | 주제 목록 전체(변경 시 자동 전송, 명령 응답에도 사용) |
| 양방향 | `ping` / `pong` | keep-alive |

전송: Native Messaging(stdio, 32bit 길이 prefix + UTF-8 JSON). host→ext 1 MB 제한.
호스트 이름(EXT `connectNative`): `com.mactechin.chrome_tap_manager` — `bridge/`가 등록하는 manifest의 `name`과 일치해야 한다.

상태: v0.1 (Extension E10에서 확정, 2026-09-13)
