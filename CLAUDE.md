# AGENTS.md

## Commands

```bash
npm run dev             # Dev with HMR (electron-vite)
npm run build           # Prod build (also runs tsc)
npm run typecheck       # tsc --noEmit for both node + web tsconfigs
npm run lint            # eslint .
npm run build:win       # Package Windows installer (also :mac / :linux)
```

No test suite. Verify with `npm run typecheck && npm run dev`.

## Architecture

Three-process Electron (electron-vite builds each separately):

| Process | Path | Role |
|---------|------|------|
| **main** | `src/main/` | Window, IPC, `loadInventory()` → decode → parse → merge DB → persist |
| **preload** | `src/preload/` | `contextBridge` exposes `window.api` |
| **renderer** | `src/renderer/` | React 19 + Tailwind v4 + shadcn/ui (new-york style) |
| **shared** | `src/shared/` | `types.ts` + `parser.ts` — imported by both main and renderer |

### Critical data-flow facts

- **`DNF.trc` resets on game restart**. Never trust trc alone — `loadInventory()` layers fresh parses over SQLite-stored characters. Unobserved characters stay visible; observed ones merge per-storage via `mergeCharacter` in `parser.ts`. Only vault-type storages (`PERSIST_WHEN_UNOBSERVED` in `parser.ts`: マイ金庫1/2, アカウント金庫, クリーチャー, and the shared リスト1/リスト9/その他) carry forward stale stored data when not re-observed this session — everything else (インベントリ, 装備, and other position-labeled `リストN` lists) is fully replaced by the fresh session's data, or dropped if absent from it. This matters because unmarked lists are named by their position among that session's lists, so the same storage can land on a different `リストN` between sessions; blindly unioning old and new would leave orphaned stale entries (e.g. sold/used items that never disappear) under the old position number.
- **File watching is polling-based** (`src/main/trc.ts`). `fs.watch` misses the game's buffered/memory-mapped writes. Uses `stat` every ~1s with throttle. Path: `~/AppData/LocalLow/DNF/DNF.trc`.
- **SQLite via `node:sqlite`** (`DatabaseSync`, built into Electron 43's Node). No native modules (better-sqlite3 etc). One row per character name, `lists` stored as JSON, in `userData/inventory.db`.
- **Decryption**: byte table XOR + ROL cipher, then unescape `0x42 0x5E` → `0x5E`, decode as Shift_JIS/cp932.
- **Shared lists**: list positions 1 (アカウント金庫), 9 (キューブ・ソウル), and 10 (その他) are account-wide. `App.tsx` hoists them into standalone sidebar entries, deduping to the snapshot with the newest `updatedAt` (per-character last-observed timestamp) — not the one with the most items, since item counts can legitimately shrink.
- **Live updates**: `watchTrc` → `loadInventory()` → `inventory:updated` IPC → `App.tsx` `refreshResult` swaps data without resetting selection/search.
- **Parser** (`src/shared/parser.ts`): line-oriented state machine. `CHAR_START` opens a character, storage markers name lists, `Item Info List(Count: N)` opens a list. Within file, later sessions of the same character win (file is chronological).

## Conventions

- **Language**: Japanese for comments and user-facing strings
- **Path aliases** (renderer only, from `electron.vite.config.ts`): `@` and `@renderer` → `src/renderer/src`, `@shared` → `src/shared`
- **shadcn/ui**: add components under `src/renderer/src/components/ui/`; config in `components.json`
- **ESM throughout** (`"type": "module"`); main/preload externalize deps via `externalizeDepsPlugin`
- **CSS**: Tailwind v4 (`@import 'tailwindcss'`), dark theme only (oklch vars in `main.css`)
- **No CI/CD config** in repo; no commit hooks, no formatter config

## Key files

- `src/main/index.ts` — app entrypoint, IPC handlers
- `src/main/trc.ts` — DNF.trc decode + poll watcher
- `src/main/db.ts` — SQLite persistence
- `src/shared/parser.ts` — trace log parser + merge logic
- `src/shared/types.ts` — data model
- `src/renderer/src/App.tsx` — whole UI
- `src/preload/index.ts` — IPC bridge
- `electron.vite.config.ts` — build config, path aliases
- `components.json` — shadcn/ui config
