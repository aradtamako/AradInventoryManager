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
