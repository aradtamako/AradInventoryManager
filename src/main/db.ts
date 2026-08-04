import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { app } from 'electron'
import type { CharacterInventory, ItemList } from '../shared/types'

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

export function closeDb(): void {
  db?.close()
  db = null
}
