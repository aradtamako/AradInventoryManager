export interface InventoryItem {
  name: string
  itemId: number
  slotIndex: number
  data: number
  durability: number
  isSealed: boolean
  enchantIndex: number
  amplifyType: number
  amplifyValue: number
}

export interface ItemList {
  storage: string
  count: number
  items: InventoryItem[]
}

export interface CharacterInventory {
  name: string
  time: string
  lists: ItemList[]
  totalItems: number
  prefix: string
  // このキャラクターのデータを最後に実際に観測・保存した日時（ISO文字列）。
  // アカウント金庫等の共有ストレージで、複数キャラの中からどれが最新の
  // スナップショットかを判定するために使う。
  updatedAt?: string
}

export interface ParseResult {
  characters: CharacterInventory[]
  sourcePath: string
  parsedAt: string
  characterOrder?: string[]
}

export interface ParseError {
  error: string
}

export interface DailyTrackedItemRecord {
  date: string
  itemName: string
  count: number
  recordedAt: string
}

export interface DailyTrackedItemCharacterRecord {
  date: string
  itemName: string
  characterName: string
  count: number
  recordedAt: string
}
