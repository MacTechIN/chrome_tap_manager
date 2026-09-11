# protocol

Extension ↔ Desktop 간 Bridge 메시지 **JSON Schema**. 세 앱(`extension/`, `desktop/`, `bridge/`)이 공유하는 유일한 계약이다.

- 각 앱은 이 스키마에서 자기 언어의 타입을 **각자 생성**한다. 앱 간 코드 import는 금지.
- 스키마 변경 시 `VERSION`을 올리고 루트 `history.md`에 기록한다.
- 메시지 목록 초안: `docs/functional_spec.md` §6.3

상태: 스키마 미작성 (Extension 계획 E10에서 v0.1 작성 예정)
