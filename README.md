# Arad Inventory Manager

DNF（アラド戦記）のトレースログからキャラクターごとのインベントリを読み込んで管理するデスクトップアプリです。

**技術構成:** Electron + TypeScript + React + Vite + Tailwind CSS v4 + shadcn/ui

## 使い方

1. `ファイルを開く` でトレースログ（`.txt`）を選択、または `テキストを貼り付け` でログを直接貼り付けて解析します。
2. 左サイドバーでキャラクターを選択します（`game start with character [ 名前 ]` から自動検出）。
3. 金庫チップで絞り込み、検索ボックスでアイテム名／IDを検索できます。

同じキャラクターが複数回ログインしている場合は、最も所持数が多いスナップショットを採用します。

## 開発

```bash
npm install       # electron バイナリの取得を含む
npm run dev       # 開発起動（HMR）
npm run typecheck # 型チェック
npm run build     # プロダクションビルド
npm run build:win # Windows 向けパッケージング
```

## 構成

- `src/main` — Electron メインプロセス（ファイルダイアログ・ログ読み込み IPC）
- `src/preload` — レンダラーへ公開する API
- `src/renderer` — React UI（shadcn/ui コンポーネント）
- `src/shared` — 型定義とトレースログのパーサー（`parser.ts`）
