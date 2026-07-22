import type { CharacterInventory, InventoryItem, ItemList, ParseResult } from './types'

// 保存済み（前回起動時までの）キャラクターと、今回 trc から読み取った新しいキャラクターを
// マージする。DNF.trc はゲーム再起動で初期化されるため、今回観測されなかったキャラクターは
// 保存済みの内容をそのまま残し、観測されたキャラクターはストレージ単位で新しい方を採用する。
//
// - 今回観測されたキャラクターは、保存済みの同名キャラのリストに対して、同じ storage を
//   新しいリストで上書きする（＝金庫を開かずにログインしても、前回の金庫データが消えない）。
// - 今回観測されなかったキャラクターは保存済みのまま表示に残る。
export function mergeCharacter(
  stored: CharacterInventory | undefined,
  fresh: CharacterInventory
): CharacterInventory {
  if (!stored) {
    const totalItems = fresh.lists.reduce((n, l) => n + l.items.length, 0)
    return { ...fresh, totalItems }
  }
  const byStorage = new Map<string, ItemList>()
  for (const list of stored.lists) byStorage.set(list.storage, list)
  for (const list of fresh.lists) byStorage.set(list.storage, list) // 新しい方を優先
  const lists = [...byStorage.values()]
  const totalItems = lists.reduce((n, l) => n + l.items.length, 0)
  return {
    name: fresh.name,
    time: fresh.time || stored.time,
    lists,
    totalItems
  }
}

const LOG_PREFIX = /^\[\d{2}:\d{2}:\d{2}\]\s*\[[^\]]*\]\s*/
const CHAR_START = /game start with character \[\s*(.+?)\s*\]/
const LIST_HEADER = /^Item Info List\(Count\s*:\s*(\d+)\)/
const STORAGE_MARKER = /^ENUM_(ITEMSPACE_[A-Z0-9_]+)\s*:\s*\d+/
const CREATURE_PACKET = /\[RECV\]\s*ENUM_NOTIPACKET_(CREATURE_ITEM_LIST)/
const TIME_PREFIX = /^\[(\d{2}:\d{2}:\d{2})\]/

const ITEM_ROW =
  /^(.+?)\((\d+)\)\s*:\s*SlotIndex\((\d+)\),\s*Data\((-?\d+)\).*?Durability\((-?\d+)\).*?isSealed\((\d+)\).*?enchantIndex\((-?\d+)\).*?amplify_type\((-?\d+)\),\s*amplify_value\((-?\d+)\)/

const STORAGE_LABELS: Record<string, string> = {
  ITEMSPACE_INVENTORY: 'インベントリ',
  ITEMSPACE_EQUIPPED: '装備',
  ITEMSPACE_AVATAR: 'アバター',
  ITEMSPACE_CARGO: 'マイ金庫1',
  ITEMSPACE_CARGO_2ND: 'マイ金庫2',
  ITEMSPACE_ACCOUNT_CARGO: 'アカウント金庫',
  CREATURE_ITEM_LIST: 'クリーチャー'
}

// ストレージマーカーを持たないリストは出現位置で命名される。
// 特定位置のリストには意味のある名称を割り当てる（キーは1始まりの位置番号）。
// リスト1（アカウント金庫）・リスト9（キューブ・ソウル）は全キャラ共通のため
// App 側で共有エントリとして扱う。
const POSITION_LABELS: Record<number, string> = {
  2: 'キャラクター',
  3: 'アバター',
  7: '異名',
  8: '不明',
  10: 'その他'
}

function stripPrefix(line: string): string {
  return line.replace(LOG_PREFIX, '').replace(/^\s+/, '')
}

function labelFor(raw: string | null, index: number): string {
  if (raw && STORAGE_LABELS[raw]) return STORAGE_LABELS[raw]
  if (raw) return raw
  const pos = index + 1
  return POSITION_LABELS[pos] ?? `リスト${pos}`
}

function parseItemRow(line: string): InventoryItem | null {
  const m = line.match(ITEM_ROW)
  if (!m) return null
  return {
    name: m[1].trim(),
    itemId: Number(m[2]),
    slotIndex: Number(m[3]),
    data: Number(m[4]),
    durability: Number(m[5]),
    isSealed: m[6] !== '0',
    enchantIndex: Number(m[7]),
    amplifyType: Number(m[8]),
    amplifyValue: Number(m[9])
  }
}

export function parseTraceLog(text: string, sourcePath = ''): ParseResult {
  const lines = text.split(/\r?\n/)
  const sessions: CharacterInventory[] = []

  let current: CharacterInventory | null = null
  let activeList: ItemList | null = null
  let remaining = 0
  let pendingStorage: string | null = null

  for (const rawLine of lines) {
    const charMatch = rawLine.match(CHAR_START)
    if (charMatch) {
      const time = rawLine.match(TIME_PREFIX)?.[1] ?? ''
      current = { name: charMatch[1], time, lists: [], totalItems: 0 }
      sessions.push(current)
      activeList = null
      remaining = 0
      pendingStorage = null
      continue
    }

    if (!current) continue

    const creatureMatch = rawLine.match(CREATURE_PACKET)
    if (creatureMatch) {
      pendingStorage = creatureMatch[1]
      continue
    }

    const line = stripPrefix(rawLine)

    const storageMatch = line.match(STORAGE_MARKER)
    if (storageMatch) {
      pendingStorage = storageMatch[1]
      continue
    }

    const listMatch = line.match(LIST_HEADER)
    if (listMatch) {
      const count = Number(listMatch[1])
      activeList = {
        storage: labelFor(pendingStorage, current.lists.length),
        count,
        items: []
      }
      current.lists.push(activeList)
      remaining = count
      pendingStorage = null
      continue
    }

    if (activeList && remaining > 0) {
      const item = parseItemRow(line)
      if (item) {
        activeList.items.push(item)
        current.totalItems += 1
        remaining -= 1
      }
    }
  }

  // DNF.trc は行末に近いほど新しいデータ。sessions はファイルの出現順なので、
  // 同名キャラは後勝ち（＝最後に現れたセッション）を採用して最新の状態を優先する。
  const byName = new Map<string, CharacterInventory>()
  for (const session of sessions) {
    byName.set(session.name, session)
  }

  const characters = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name, 'ja'))

  return {
    characters,
    sourcePath,
    parsedAt: new Date().toISOString()
  }
}
