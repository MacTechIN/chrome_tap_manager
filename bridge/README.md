# bridge

Chrome Native Messaging 프록시 호스트. Chrome이 띄우는 stdio 프로세스를 Unix socket(macOS) / Named pipe(Windows)로 중계해 실행 중인 `desktop/` 앱에 연결한다 (KeePassXC / Bitwarden 패턴).

- 독립 프로젝트: 자체 `Cargo.toml`, 자체 빌드·테스트. 호스트 manifest 등록 스크립트 포함 예정.
- `extension/`, `desktop/` 코드를 import하지 않는다. 공유 계약은 `protocol/`뿐.
- 착수 시점: `protocol/` v0.1 확정 후. 계획서는 `bridge/DEV_PLAN.md`로 별도 작성.

상태: 미착수
