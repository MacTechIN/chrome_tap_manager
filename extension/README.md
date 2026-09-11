# extension

Chrome_Project_manager의 Chrome Extension (MV3). 계획서: [DEV_PLAN.md](DEV_PLAN.md).

## 요구 사항
- Node 24+, pnpm 12+ (`npm i -g pnpm`)

## 명령

| 명령 | 설명 |
|---|---|
| `pnpm install` | 의존성 설치 (`postinstall`에서 `wxt prepare`로 `.wxt/` 타입 생성) |
| `pnpm dev` | 개발 모드. Chrome이 자동으로 뜨고 `.output/chrome-mv3-dev`를 로드, HMR |
| `pnpm build` | 프로덕션 빌드 → `.output/chrome-mv3/` |
| `pnpm zip` | 스토어 업로드용 zip → `.output/` |
| `pnpm test` | Vitest 1회 실행 (`tests/**/*.test.ts`, `src/**/*.test.ts`) |
| `pnpm test:watch` | Vitest watch |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm lint` | ESLint + Prettier 검사 |
| `pnpm format` | Prettier 적용 |

수동 로드: `chrome://extensions` → 개발자 모드 → "압축해제된 확장 프로그램 로드" → `.output/chrome-mv3/`.

## 구조

```
src/
  entrypoints/   background.ts, popup/ (E06부터 검색창), sidepanel/ (E08), options/ (E12)
  core/          순수 로직. Chrome API 직접 호출 금지 (Vitest로 테스트)
  chrome/        Chrome API 어댑터 (E02부터)
  bridge/        native messaging 클라이언트 (E10부터)
  ui/            공용 UI 컴포넌트
tests/           단위 테스트
```

`import { browser, defineBackground } from '#imports'`는 WXT가 제공하는 자동 import 모듈이다.
