# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Electron desktop app that reads per-character inventories from DNF (アラド戦記 / Dungeon & Fighter) trace logs. It decrypts the game's `DNF.trc` file, parses it, persists snapshots to SQLite, and displays them in a React UI. The codebase and UI are in Japanese; keep comments and user-facing strings in Japanese to match.

## Commands

```bash
npm run dev        # Launch app in dev with HMR (electron-vite)
npm run build      # Production build (also runs typecheck via tsc)
npm run typecheck  # Both node + web tsconfigs; typecheck:node / typecheck:web run each alone
npm run lint       # eslint .
npm run build:win  # Package a Windows installer (electron-builder); also :mac / :linux
```

There is no test suite. Verify changes with `npm run typecheck` and by running `npm run dev`.

## Architecture

Three-process Electron layout (electron-vite builds each separately):

- **`src/main`** — Electron main process (Node).
  - `index.ts` — window creation, IPC handlers, and `loadInventory()` which orchestrates decode → parse → merge with stored → persist.
  - `trc.ts` — decrypts `DNF.trc` (byte table + ROL cipher, then un-escapes `0x42 0x5E` → `0x5E`, decodes as Shift_JIS/cp932) and **polls** the file via `stat` (not `fs.watch`, which misses the game's buffered writes), throttled to ~1s. Path: `~/AppData/LocalLow/DNF/DNF.trc`.
  - `db.ts` — SQLite persistence via `node:sqlite` (`DatabaseSync`, built into Electron 43's Node — no native module). One row per character name, `lists` stored as JSON, in `userData/inventory.db`.
- **`src/preload`** — `contextBridge` exposes `window.api` (`openFile`, `parseText`, `onUpdate`). `index.d.ts` types the global.
- **`src/renderer`** — React 19 + Tailwind v4 + shadcn/ui (new-york style). `App.tsx` is the whole UI; primitives live under `components/ui/`.
- **`src/shared`** — `types.ts` (data model) and `parser.ts`. Imported by both main and renderer.

### Key data-flow concepts

- **`DNF.trc` resets on game restart**, so the app never trusts the trc alone. `loadInventory()` layers freshly-parsed characters over SQLite-stored ones: unobserved characters stay visible from storage; observed ones are updated and re-persisted. See `mergeCharacter` in `parser.ts` — it merges **per storage** (`ITEMSPACE_*`), so opening the game without opening a vault won't erase the last-seen vault contents.
- **`parseTraceLog`** (`parser.ts`) is a line-oriented state machine: `game start with character [ 名前 ]` starts a character, `ENUM_ITEMSPACE_*` / `CREATURE_ITEM_LIST` markers name the next list, `Item Info List(Count: N)` opens a list, then `ITEM_ROW` regex parses N item rows. Within a file, later sessions of the same character win (file is chronological). Lists lacking a storage marker are named by position (`POSITION_LABELS`).
- **Shared lists**: list positions 1 (アカウント金庫) and 9 (キューブ・ソウル) are account-wide. `App.tsx` (`SHARED_DEFS`) hoists these out of each character into standalone sidebar entries, deduping to the largest snapshot.
- **Live updates**: `watchTrc` triggers `loadInventory()` on file change and pushes results to the renderer via `inventory:updated`; `App.tsx` `refreshResult` swaps data without resetting the user's selection/search.

## Conventions

- Path aliases (renderer only, defined in `electron.vite.config.ts`): `@` and `@renderer` → `src/renderer/src`, `@shared` → `src/shared`.
- Add shadcn/ui components under `src/renderer/src/components/ui/`; config in `components.json`.
- ESM throughout (`"type": "module"`); main/preload externalize deps via `externalizeDepsPlugin`.
