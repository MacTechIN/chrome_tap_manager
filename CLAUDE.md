# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Current state

Planning documents are done. The Chrome Extension is being implemented step by step (`extension/DEV_PLAN.md`; E00–E03 done, next E04 "Topic = window model"). `desktop/` and `bridge/` have no code yet. Remote: https://github.com/MacTechIN/chrome_tap_manager.git.

## Commands — extension/ (run inside `extension/`)

Requires Node 24+ and pnpm 12 (`npm i -g pnpm`). `pnpm install` runs `wxt prepare` to generate `.wxt/` types (needed before typecheck).

```
pnpm dev          # dev mode, launches Chrome with .output/chrome-mv3-dev, HMR
pnpm build        # production build -> .output/chrome-mv3/
pnpm test         # vitest run (tests/**/*.test.ts, src/**/*.test.ts)
pnpm test:watch
pnpm typecheck    # tsc --noEmit
pnpm lint         # eslint . && prettier --check .  (*.md ignored)
pnpm format
pnpm zip          # store zip
```

Run a single test file: `pnpm vitest run tests/core/repo.test.ts`. Filter by name: `pnpm vitest run -t "cascades"`.

Notes: WXT 0.21 exports the test helpers as `wxt/testing/vitest-plugin` and `wxt/testing/fake-browser` (not `wxt/testing`). Import `browser`, `defineBackground` etc. from `#imports`. `src/core/` must never touch Chrome APIs. Versions are pinned exactly in `package.json`; TypeScript stays on 5.9.x.

Extension code layout (as built so far): `src/core/model.ts` (domain types), `fingerprint.ts` (URL/title normalize + FNV-1a id), `invariants.ts` (window=topic invariant checker), `repo.ts` (`Repo` over a `KeyValueStore`; `MemoryKV` for tests), `liveState.ts` (pure reducer mirroring open windows/tabs with a monotonic `seq`), `liveTracker.ts` (owns LiveState in the SW: restores `seq` from `storage.session`, rebuilds from `windows.getAll`, queues events during startup), `messages.ts` (runtime message types). `src/chrome/storageKv.ts` and `src/chrome/events.ts` are the only Chrome adapters. Test gotchas: `@webext-core/fake-browser` 2.0.1 lacks `tabs.onMoved/onAttached/onDetached` (tests install stubs) and its windows have no `type` (adapter treats missing type as normal).

Manual check in Chrome: with `pnpm dev` running, load `.output/chrome-mv3-dev` unpacked; `Alt+R` reloads after a rebuild. The popup shows live window/tab counts and `seq`.

When code is added to `desktop/` or `bridge/`, add that app's actual commands here.

## Mandatory working rules

These were set by the user and apply to every session:

1. **App isolation.** `extension/`, `desktop/`, `bridge/` are independent projects with their own manifest, build, tests, and lint. Never import across these folders. The only shared artifact is the JSON Schema in `protocol/` (each app generates its own types from it; bump `protocol/VERSION` on change). A change in one app must not break another app's build or tests. Per-app tags: `ext-v*`, `desktop-v*`, `bridge-v*`; root `v*` tags are for docs / whole-project milestones.
2. **history.md (원칙 1).** At every development step, append an entry to the root `history.md` in chronological order: user request, what was done, decisions, deliverables, commit. Never edit or reorder existing entries. Update it before ending a work session.
3. **README.md.** Keep the "진행 현황" tables and "버전 히스토리" table in the root `README.md` current, in chronological order. Update whenever a step's status changes or a commit/tag is made. The Extension step table must match the checklist in `extension/DEV_PLAN.md` §4.
4. **Micro-process.** Follow `extension/DEV_PLAN.md` step by step (E00 → E12). A step is done only when its 완료 기준 are met, `history.md` has an entry, and (for release steps) README's version history is updated. Do not pull later steps forward; if blocked, split the step and bump the plan's version.

## Documents (read these first)

- `docs/project_definition.md` — original one-paragraph project intent (Korean).
- `docs/research.md` — tech-stack research (Chrome extension APIs, desktop tray/launcher frameworks, extension↔desktop bridge, search/AI models). Contains the reasoning behind every stack choice below.
- `docs/functional_spec.md` — 기능정의서: feature list F-01..F-16 with priorities, non-functional requirements, data model, bridge message draft, release milestones M1..M4, and open questions.
- `extension/DEV_PLAN.md` — micro-process plan for the Extension: steps E00..E12 with goal / deliverables / done criteria / verification / dependencies, milestones EM1..EM6, risks.
- `history.md` — chronological log of every development step (rule 2 above).
- `README.md` — progress status and version history (rule 3 above).

## Repository layout

```
docs/        planning documents
protocol/    Bridge message JSON Schema (only shared contract) + VERSION
extension/   Chrome Extension (WXT + TypeScript + Solid)   ← implement first
desktop/     Tauri v2 tray app (not started)
bridge/      Native Messaging proxy host (not started)
```

## Project intent

Chrome_Project_manager: a developer utility that organizes Chrome tabs by topic, gathers same-topic tabs into a single Chrome window, and provides a Spotlight-style always-on-top search box that brings the Chrome window holding a matching tab to the foreground. Two deliverables sharing one feature set: a Chrome Extension and a memory-resident tray app for Windows and macOS.

## Chosen architecture (from docs/research.md)

- **Organizing model (decided, spec v0.2)**: **one Chrome window = one Topic.** Every normal window automatically becomes a Topic (auto-named until the user renames it); closing a window turns the Topic into `saved`. There is no "unassigned" tab. The only organizing action is "send this tab to [topic]" (`tabs.move`, or `windows.create` for a new topic), driven from the search box (`>move`, `>new`, `>rename`, `>open`, `>close`). Tab Groups are an optional sub-structure the extension never creates on its own. Rules are learned from repeated moves and proposed once, never configured up front.
- **Extension**: Manifest V3, built with WXT + TypeScript + Solid. Uses `tabs`, `windows`, `storage`, `commands`, `contextMenus`, later `tabGroups`, `sidePanel`, `nativeMessaging`, `omnibox`. Core invariant: `open` Topic ↔ normal window 1:1, every open tab has a `topicId`.
- **Desktop app**: Tauri v2 (Rust backend, small web UI). Tray-resident, global hotkey, frameless always-on-top launcher; macOS uses a non-activating NSPanel (`tauri-nspanel`) and `ActivationPolicy::Accessory`.
- **Bridge**: Chrome Native Messaging with a thin proxy host that relays stdio to a Unix socket (macOS) / named pipe (Windows) owned by the tray app (KeePassXC / Bitwarden pattern). The open `connectNative` port also keeps the MV3 service worker alive. Do not build the core loop on `--remote-debugging-port` (blocked on the default profile since Chrome 136) or on SNSS session-file parsing.
- **Bring-to-front rule**: `chrome.windows.update({focused:true})` alone fails when Chrome is in the background (OS foreground-lock). The extension activates tab + window, then the tray app (which owns foreground at keypress time) raises Chrome at the OS level: Win32 `SetForegroundWindow` with `AttachThreadInput` fallback; macOS `osascript` against Chrome's AppleScript dictionary (needs only Automation permission, avoid Screen Recording).
- **Source of truth**: desktop SQLite. Extension keeps a cache in `chrome.storage.local`; deltas carry a monotonic `seq`, full resync on reconnect, last-writer-wins on `updated_at`. Tab identity is a URL+title fingerprint because Chrome `tabId` resets on restart.
- **Search**: keyword-first. Extension: MiniSearch with es-hangul (index raw + jamo-decomposed + 초성 forms). Desktop: nucleo fuzzy matcher with a hand-written Hangul jamo decomposer. Optional semantic tier: `multilingual-e5-small` int8 (same model on both sides), brute-force cosine in the extension, sqlite-vec on desktop.
- **Korean IME**: search on `input` events, guard Enter with `!isComposing && keyCode !== 229`, normalize NFC. Test with the Windows Microsoft Korean IME and macOS 2-set Korean.
