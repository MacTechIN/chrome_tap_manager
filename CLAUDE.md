# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Current state

Planning documents are done. The Chrome Extension is being implemented step by step (`extension/DEV_PLAN.md`; E00–E08 done, next E09 "rules: learned suggestions + manual rules"). `desktop/` and `bridge/` have no code yet. Remote: https://github.com/MacTechIN/chrome_tap_manager.git.

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
pnpm static       # wxt build + copy into .output/chrome-mv3-dev (no dev server needed; same extension ID)
```

Run a single test file: `pnpm vitest run tests/core/repo.test.ts`. Filter by name: `pnpm vitest run -t "cascades"`.

Notes: WXT 0.21 exports the test helpers as `wxt/testing/vitest-plugin` and `wxt/testing/fake-browser` (not `wxt/testing`). Import `browser`, `defineBackground` etc. from `#imports`. `src/core/` must never touch Chrome APIs. Versions are pinned exactly in `package.json`; TypeScript stays on 5.9.x.

Extension code layout (as built so far): `src/core/model.ts` (domain types), `fingerprint.ts` (URL/title normalize + FNV-1a id), `invariants.ts` (window=topic invariant checker), `repo.ts` (`Repo` over a `KeyValueStore`; `MemoryKV` for tests), `liveState.ts` (pure reducer mirroring open windows/tabs with a monotonic `seq`), `liveTracker.ts` (owns LiveState in the SW: restores `seq` from `storage.session`, rebuilds from `windows.getAll`, queues events during startup), `autoName.ts` (provisional topic names: one tab → site, many → most common host, none → "새 주제 N"), `topicService.ts` (window=topic lifecycle driven by LiveEvents; `rename`, `deleteSaved`, `listTopics`; wraps each event in `Repo.batch()`), `messages.ts` (runtime message types), `search/hangul.ts` (tokenize + raw/jamo/초성 variants via es-hangul, applied per token so Latin tokens survive), `search/fuzzy.ts` (fzf-style subsequence scorer; `prepareQuery` once per search, targets pre-compacted), `search/index.ts` (`SearchIndex`: MiniSearch over raw/jamo/cho fields + fuzzy pass + boosts: exact topic name first, current window, recency, open>saved; scopes all/saved/topic), `command.ts` (input grammar `#topic`, `>move|new|rename|close|merge`; `suggestCommands` with Hangul-aware topic completion), `searchDocs.ts` (Repo snapshot → SearchDoc[]), `ime.ts` (Enter/IME guards, `enterVariant`: plain / Ctrl+Enter=window / Shift+Enter=switch), `commandRunner.ts` (`CommandRunner`: focus tab/topic — targets must be open; move / newTopic / rename / merge; writes moveLog). `src/chrome/actions.ts` implements `ChromeActions` for the runner. `background.ts` owns the `SearchIndex` (rebuilt lazily when dirty), the context menu "주제로 보내기 ▸", the `send-to-last-topic` command, and answers `search`, `cmd.*` messages. The popup (`entrypoints/popup/App.tsx`, Solid) is the search box: rows are search hits or command suggestions; Enter/Tab/Esc/arrows; `>close` and `>save` are deferred to E11. Session handling: `background.ts` stores a marker under `ctm:session` in `storage.session`; when it is missing (browser restart / extension reload) `TopicService` is created with `freshSession: true`: stale open topics are **re-linked** to live windows by tab-fingerprint overlap (Jaccard ≥ 0.5, greedy one-to-one, `matchWindows`/`relink`), the rest become `saved`, and saved topics that duplicate an open window (≥ 0.8, named or not) are **absorbed** into it (`absorbIfDuplicate`: an unnamed open topic inherits the name, then the copy is deleted). `CommandRunner.restoreTopic` runs the same check first, so selecting such a copy focuses the live window instead of opening a second one. Never revert to "save everything on reload": that produced duplicate saved copies whose restore opened a second identical window (bug fixed 2026-09-12). `buildSearchDocs` also hides saved tabs identical to an open tab. Chrome fires `tabs.onRemoved(isWindowClosing=true)` for each tab before `windows.onRemoved`; the service keeps those rows (closed, no chromeTabId) so the saved topic retains its tab list. Sub-groups (E08): `LiveState.groups` mirrors `chrome.tabGroups` (read-only — the extension never creates or edits groups); `TopicService` keeps `Subgroup` rows (`chromeGroupId` ↔ live group, matched by id then by name), binds `Tab.subgroupId` from `LiveTab.groupId` (`rowFor`), keeps subgroup name/color on a saved topic when its window closes, and serves `tree()` for the side panel. The side panel (`entrypoints/sidepanel/`, Solid) is the secondary UI: topic → subgroup → tab tree, drag a tab onto a topic card to `cmd.move`, click name/dot to rename/recolor (`topic.setColor`); opened from the popup footer via `sidePanel.open`. `src/chrome/storageKv.ts`, `src/chrome/events.ts`, `src/chrome/actions.ts`, `src/chrome/omnibox.ts` are the only Chrome adapters. Test gotchas: `@webext-core/fake-browser` 2.0.1 lacks `tabs.onMoved/onAttached/onDetached` (tests install stubs) and its windows have no `type` (adapter treats missing type as normal).

**Preferred manual-test loop on this machine (low RAM, dev server got OOM-killed): `pnpm static`, then ↻ the extension in chrome://extensions.** `pnpm static` writes the production build into `.output/chrome-mv3-dev`, the folder Chrome already has loaded, so the extension ID and stored data survive and nothing depends on localhost. `scripts/sync-static.mjs` copies by hand because `fs.cpSync({recursive:true})` crashes Node 24.14 here (0xC0000409, non-ASCII user path). Dev-server alternative: with `pnpm dev` running, load `.output/chrome-mv3-dev` unpacked; `Alt+R` reloads after a rebuild. **After editing `wxt.config.ts` (manifest), restart `pnpm dev`** — the running dev server keeps serving the old dev manifest, and a background that touches an API the manifest does not declare (e.g. `chrome.omnibox`) throws at SW startup, which silently drops every listener registered after it (popup then gets no reply → "결과 없음"). Guard optional APIs (`if (!browser.omnibox) return`) and keep `runtime.onMessage` registration robust. Omnibox: `core/omniboxSuggest.ts` (pure: `<match>` highlighting with XML escaping, `ctm:tab:<rowId>` / `ctm:topic:<id>` content encoding) + `chrome/omnibox.ts` (adapter; keyword `t`). The popup footer shows a diagnostics line from `debug.stats` (topics open/total, tab rows open/total, index size, live windows/tabs, seq, storage KB, last background errors) — read it before guessing at field bugs. The popup is the search box (E06); `>move 이름`, `>new 이름`, `>rename 이름`, `>open 이름`, `>merge 이름` work end to end.

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

- **Organizing model (decided, spec v0.3)**: **one Chrome window = one Topic, and a Topic lives exactly as long as its window.** Every normal window automatically becomes a Topic (auto-named until the user renames it); closing a window deletes the Topic, named or not — there are no "saved" topics any more (user decision 2026-09-12: "열려 있지 않은 창은 필요 없다"). Search, popup and side panel show only open windows/tabs. After a browser restart, windows that Chrome restores are re-linked to their old Topic by tab fingerprints. `Topic.status` still exists in the schema but is always `open`; any `saved` rows found in storage are legacy and get absorbed/purged in `reconcile`. There is no "unassigned" tab. The only organizing action is "send this tab to [topic]" (`tabs.move`, or `windows.create` for a new topic), driven from the search box (`>move`, `>new`, `>rename`, `>open`, `>close`). Tab Groups are an optional sub-structure the extension never creates on its own. Rules are learned from repeated moves and proposed once, never configured up front.
- **Extension**: Manifest V3, built with WXT + TypeScript + Solid. Uses `tabs`, `windows`, `storage`, `commands`, `contextMenus`, later `tabGroups`, `sidePanel`, `nativeMessaging`, `omnibox`. Core invariant: `open` Topic ↔ normal window 1:1, every open tab has a `topicId`.
- **Desktop app**: Tauri v2 (Rust backend, small web UI). Tray-resident, global hotkey, frameless always-on-top launcher; macOS uses a non-activating NSPanel (`tauri-nspanel`) and `ActivationPolicy::Accessory`.
- **Bridge**: Chrome Native Messaging with a thin proxy host that relays stdio to a Unix socket (macOS) / named pipe (Windows) owned by the tray app (KeePassXC / Bitwarden pattern). The open `connectNative` port also keeps the MV3 service worker alive. Do not build the core loop on `--remote-debugging-port` (blocked on the default profile since Chrome 136) or on SNSS session-file parsing.
- **Bring-to-front rule**: `chrome.windows.update({focused:true})` alone fails when Chrome is in the background (OS foreground-lock). The extension activates tab + window, then the tray app (which owns foreground at keypress time) raises Chrome at the OS level: Win32 `SetForegroundWindow` with `AttachThreadInput` fallback; macOS `osascript` against Chrome's AppleScript dictionary (needs only Automation permission, avoid Screen Recording).
- **Source of truth**: desktop SQLite. Extension keeps a cache in `chrome.storage.local`; deltas carry a monotonic `seq`, full resync on reconnect, last-writer-wins on `updated_at`. Tab identity is a URL+title fingerprint because Chrome `tabId` resets on restart.
- **Search**: keyword-first. Extension: MiniSearch with es-hangul (index raw + jamo-decomposed + 초성 forms). Desktop: nucleo fuzzy matcher with a hand-written Hangul jamo decomposer. Optional semantic tier: `multilingual-e5-small` int8 (same model on both sides), brute-force cosine in the extension, sqlite-vec on desktop.
- **Korean IME**: search on `input` events, guard Enter with `!isComposing && keyCode !== 229`, normalize NFC. Test with the Windows Microsoft Korean IME and macOS 2-set Korean.
