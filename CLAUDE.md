# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Current state

This repository is in the planning stage. There is no source code, package manifest, build system, lint config, or test suite yet. Remote: https://github.com/MacTechIN/chrome_tap_manager.git.

When code is added, update this file with the actual build / lint / test commands rather than guessing at them.

## Documents (read these first)

- `docs/project_definition.md` — original one-paragraph project intent (Korean).
- `docs/research.md` — tech-stack research (Chrome extension APIs, desktop tray/launcher frameworks, extension↔desktop bridge, search/AI models). Contains the reasoning behind every stack choice below.
- `docs/functional_spec.md` — 기능정의서: feature list F-01..F-16 with priorities, non-functional requirements, data model, bridge message draft, release milestones M1..M4, and open questions.

## Project intent

Chrome_Project_manager: a developer utility that organizes Chrome tabs by topic, gathers same-topic tabs into a single Chrome window, and provides a Spotlight-style always-on-top search box that brings the Chrome window holding a matching tab to the foreground. Two deliverables sharing one feature set: a Chrome Extension and a memory-resident tray app for Windows and macOS.

## Chosen architecture (from docs/research.md)

- **Extension**: Manifest V3, built with WXT + TypeScript. Uses `tabs`, `tabGroups`, `windows`, `storage`, `sidePanel`, `commands`, `nativeMessaging` (+ `omnibox` fallback search). Topic ↔ Chrome Tab Group mirroring; "one window per topic" via `windows.create` + `tabs.move`.
- **Desktop app**: Tauri v2 (Rust backend, small web UI). Tray-resident, global hotkey, frameless always-on-top launcher; macOS uses a non-activating NSPanel (`tauri-nspanel`) and `ActivationPolicy::Accessory`.
- **Bridge**: Chrome Native Messaging with a thin proxy host that relays stdio to a Unix socket (macOS) / named pipe (Windows) owned by the tray app (KeePassXC / Bitwarden pattern). The open `connectNative` port also keeps the MV3 service worker alive. Do not build the core loop on `--remote-debugging-port` (blocked on the default profile since Chrome 136) or on SNSS session-file parsing.
- **Bring-to-front rule**: `chrome.windows.update({focused:true})` alone fails when Chrome is in the background (OS foreground-lock). The extension activates tab + window, then the tray app (which owns foreground at keypress time) raises Chrome at the OS level: Win32 `SetForegroundWindow` with `AttachThreadInput` fallback; macOS `osascript` against Chrome's AppleScript dictionary (needs only Automation permission, avoid Screen Recording).
- **Source of truth**: desktop SQLite. Extension keeps a cache in `chrome.storage.local`; deltas carry a monotonic `seq`, full resync on reconnect, last-writer-wins on `updated_at`. Tab identity is a URL+title fingerprint because Chrome `tabId` resets on restart.
- **Search**: keyword-first. Extension: MiniSearch with es-hangul (index raw + jamo-decomposed + 초성 forms). Desktop: nucleo fuzzy matcher with a hand-written Hangul jamo decomposer. Optional semantic tier: `multilingual-e5-small` int8 (same model on both sides), brute-force cosine in the extension, sqlite-vec on desktop.
- **Korean IME**: search on `input` events, guard Enter with `!isComposing && keyCode !== 229`, normalize NFC. Test with the Windows Microsoft Korean IME and macOS 2-set Korean.
