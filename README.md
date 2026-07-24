# Arad Inventory Manager

<img width="1186" height="793" alt="image" src="https://github.com/user-attachments/assets/b7d083ea-b18c-4e41-b930-4780c8d42510" />

DNF（アラド戦記）のトレースログからキャラクターごとのインベントリを読み込んで管理するデスクトップアプリです。

**技術構成:** Electron + TypeScript + React + Vite + Tailwind CSS v4 + shadcn/ui

## ダウンロード
https://github.com/aradtamako/AradInventoryManager/releases

## 使い方

1. 上記URLからダウンロードする
2. `arad-inventory-manager.Setup.x.x.x.exe` を起動してインストールする
3. デスクトップに自動作成される `arad-inventory-manager` ショートカットをクリックして起動する
4. キャラクターを選択してゲーム開始したタイミングで自動的に情報が更新されます

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
