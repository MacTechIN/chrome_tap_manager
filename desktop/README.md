# desktop

Windows / macOS 램 상주 트레이 앱 (Tauri v2, Rust). Spotlight형 검색창과 OS 레벨 Chrome 창 전면화를 담당한다.

- 독립 프로젝트: 자체 `Cargo.toml` / `package.json`, 자체 빌드·테스트.
- `extension/`, `bridge/` 코드를 import하지 않는다. 공유 계약은 `protocol/`뿐.
- 착수 시점: Extension 계획 EM5 완료 후. 계획서는 `desktop/DEV_PLAN.md`로 별도 작성.

상태: 미착수
