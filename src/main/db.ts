import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { app } from 'electron'
import type { CharacterInventory, DailyTrackedItemRecord, ItemList } from '../shared/types'

// DNF.trc はゲームを再起動すると初期化されるため、これまでに読み取ったキャラクター
// ごとのインベントリを SQLite に保存しておき、trc が空になっても継続表示できるようにする。
//
// Electron 43 の内蔵 Node には node:sqlite（DatabaseSync）が含まれるため、
// ネイティブモジュール（better-sqlite3 等）を追加せずに永続化できる。

let db: DatabaseSync | null = null

// キャラクター名をキーに、そのキャラクターの全リストを JSON で保存する。
// updated_at は最後に観測した時刻（デバッグ・将来の掃除用）。
function getDb(): DatabaseSync {
  if (db) return db
  const file = join(app.getPath('userData'), 'inventory.db')
  db = new DatabaseSync(file)
  db.exec(`
    CREATE TABLE IF NOT EXISTS characters (
      name       TEXT PRIMARY KEY,
      time       TEXT,
      lists      TEXT NOT NULL,
      prefix     TEXT DEFAULT '',
      updated_at TEXT NOT NULL
    )
  `)
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `)
  // ユーザーが監視対象として登録したアイテム名の一覧。
  db.exec(`
    CREATE TABLE IF NOT EXISTS watched_items (
      name       TEXT PRIMARY KEY,
      created_at TEXT NOT NULL
    )
  `)
  // AM6:00 を境界とする「ゲーム日」ごとの、監視対象アイテムの所持数の記録。
  // 同じゲーム日・同じアイテムに何度書き込まれても最新の所持数で上書きし、日をまたいだら新しい行になる。
  db.exec(`
    CREATE TABLE IF NOT EXISTS tracked_item_daily (
      game_date   TEXT NOT NULL,
      item_name   TEXT NOT NULL,
      count       INTEGER NOT NULL,
      recorded_at TEXT NOT NULL,
      PRIMARY KEY (game_date, item_name)
    )
  `)
  // 既存 DB に prefix カラムが無い場合のマイグレーション
  try {
    db.exec(`ALTER TABLE characters ADD COLUMN prefix TEXT DEFAULT ''`)
  } catch {
    // 既に存在していれば無視
  }
  return db
}

// 保存済みの全キャラクターを読み込む。JSON が壊れている行はスキップする。
export function getStoredCharacters(): CharacterInventory[] {
  const rows = getDb().prepare('SELECT name, time, lists, prefix FROM characters').all() as {
    name: string
    time: string | null
    lists: string
    prefix: string | null
  }[]
  const result: CharacterInventory[] = []
  for (const row of rows) {
    try {
      const lists = JSON.parse(row.lists) as ItemList[]
      const totalItems = lists.reduce((n, l) => n + l.items.length, 0)
      result.push({ name: row.name, time: row.time ?? '', lists, totalItems, prefix: row.prefix ?? '' })
    } catch {
      // 壊れた行は無視して次へ
    }
  }
  return result
}

// 1 キャラクター分を保存（存在すれば置き換え）。
export function upsertCharacter(character: CharacterInventory): void {
  getDb()
    .prepare(
      `INSERT INTO characters (name, time, lists, prefix, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(name) DO UPDATE SET
         time = excluded.time,
         lists = excluded.lists,
         prefix = excluded.prefix,
         updated_at = excluded.updated_at`
    )
    .run(
      character.name,
      character.time,
      JSON.stringify(character.lists),
      character.prefix ?? '',
      new Date().toISOString()
    )
}

export function getCharacterOrder(): string[] {
  const row = getDb()
    .prepare('SELECT value FROM meta WHERE key = ?')
    .get('character_order') as { value: string } | undefined
  if (!row) return []
  try {
    return JSON.parse(row.value) as string[]
  } catch {
    return []
  }
}

export function saveCharacterOrder(order: string[]): void {
  getDb()
    .prepare(
      `INSERT INTO meta (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    )
    .run('character_order', JSON.stringify(order))
}

export function saveCharacterPrefix(name: string, prefix: string): void {
  getDb()
    .prepare(`UPDATE characters SET prefix = ? WHERE name = ?`)
    .run(prefix, name)
}

export function deleteCharacter(name: string): void {
  getDb().prepare(`DELETE FROM characters WHERE name = ?`).run(name)
}

// AM6:00 を1日の境界とする「ゲーム日」を返す（6時未満なら前日扱い）。
export function gameDateFor(d: Date): string {
  const shifted = new Date(d.getTime() - 6 * 60 * 60 * 1000)
  const y = shifted.getFullYear()
  const m = String(shifted.getMonth() + 1).padStart(2, '0')
  const day = String(shifted.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// 現在のゲーム日の、監視対象アイテムごとの所持数を記録（同日中は上書き、日をまたぐと新しい行になる）。
export function upsertTrackedItemRecords(items: Map<string, number>, at: Date = new Date()): void {
  const gameDate = gameDateFor(at)
  const stmt = getDb().prepare(
    `INSERT INTO tracked_item_daily (game_date, item_name, count, recorded_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(game_date, item_name) DO UPDATE SET
       count = excluded.count,
       recorded_at = excluded.recorded_at`
  )
  for (const [itemName, count] of items) {
    stmt.run(gameDate, itemName, count, at.toISOString())
  }
}

// 記録済みの全ゲーム日・全アイテムを古い順に返す。
export function getTrackedItemRecords(): DailyTrackedItemRecord[] {
  const rows = getDb()
    .prepare(
      'SELECT game_date, item_name, count, recorded_at FROM tracked_item_daily ORDER BY game_date ASC, item_name ASC'
    )
    .all() as { game_date: string; item_name: string; count: number; recorded_at: string }[]
  return rows.map((r) => ({
    date: r.game_date,
    itemName: r.item_name,
    count: r.count,
    recordedAt: r.recorded_at
  }))
}

// 監視対象アイテム名の一覧（登録順）。
export function getWatchedItemNames(): string[] {
  const rows = getDb()
    .prepare('SELECT name FROM watched_items ORDER BY created_at ASC')
    .all() as { name: string }[]
  return rows.map((r) => r.name)
}

// アイテム名を監視対象に追加する。既に登録済みなら何もしない。
export function addWatchedItem(name: string): void {
  const trimmed = name.trim()
  if (!trimmed) return
  getDb()
    .prepare(`INSERT OR IGNORE INTO watched_items (name, created_at) VALUES (?, ?)`)
    .run(trimmed, new Date().toISOString())
}

// アイテム名を監視対象から外す。過去に記録済みの日次データは履歴として残す。
export function removeWatchedItem(name: string): void {
  getDb().prepare(`DELETE FROM watched_items WHERE name = ?`).run(name)
}

export function closeDb(): void {
  db?.close()
  db = null
}
