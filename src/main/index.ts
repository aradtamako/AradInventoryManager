import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'node:path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { mergeCharacter, parseTraceLog } from '../shared/parser'
import { decodeTrc, watchTrc, type TrcWatcher, DNF_TRC_PATH } from './trc'
import {
  addWatchedItem,
  closeDb,
  deleteCharacter,
  getCharacterOrder,
  getStoredCharacters,
  getTrackedItemRecords,
  getWatchedItemNames,
  removeWatchedItem,
  saveCharacterOrder,
  saveCharacterPrefix,
  upsertCharacter,
  upsertTrackedItemRecords
} from './db'
import type { CharacterInventory, ParseResult } from '../shared/types'

// アカウント全体で共有されるストレージ（リスト1: アカウント金庫、リスト9: キューブ・ソウル）は
// キャラクターごとの trc セッションに同じ内容が重複して出現するため、最もアイテム数が多い
// スナップショットだけを採用する。それ以外のストレージはキャラクターごとに所持品が異なるため、
// 全キャラクター分をそのまま合算する。
const SHARED_STORAGES = new Set(['リスト1', 'リスト9'])

// 監視対象アイテム名ごとに、全キャラクター・全ストレージを横断した所持数の合計を返す。
function extractTrackedItemCounts(
  characters: CharacterInventory[],
  watchedNames: Set<string>
): Map<string, number> {
  const counts = new Map<string, number>()
  if (watchedNames.size === 0) return counts

  const bestShared = new Map<string, CharacterInventory['lists'][number]>()
  const addItem = (item: { name: string; data: number }): void => {
    if (!watchedNames.has(item.name)) return
    counts.set(item.name, (counts.get(item.name) ?? 0) + item.data)
  }

  for (const c of characters) {
    for (const list of c.lists) {
      if (SHARED_STORAGES.has(list.storage)) {
        const prev = bestShared.get(list.storage)
        if (!prev || list.items.length > prev.items.length) bestShared.set(list.storage, list)
        continue
      }
      for (const item of list.items) addItem(item)
    }
  }
  for (const list of bestShared.values()) {
    for (const item of list.items) addItem(item)
  }
  return counts
}

let trcWatcher: TrcWatcher | null = null

// DNF.trc を復号してパースし、SQLite に保存済みの前回起動時までのデータとマージする。
//
// DNF.trc はゲーム再起動で初期化されるため、trc から読み取れたキャラクターだけでは
// 前回のデータが消えてしまう。保存済みデータとマージすることで、今回観測されなかった
// キャラクターも継続表示でき、観測されたキャラクターは最新の内容に更新される。
async function loadInventory(): Promise<ParseResult> {
  const text = await decodeTrc(DNF_TRC_PATH)
  const parsed = parseTraceLog(text, DNF_TRC_PATH)

  // 保存済みキャラクターを土台にし、今回観測したキャラクターをマージして上書きする。
  const byName = new Map<string, CharacterInventory>()
  for (const stored of getStoredCharacters()) byName.set(stored.name, stored)
  for (const fresh of parsed.characters) {
    const merged = mergeCharacter(byName.get(fresh.name), fresh)
    byName.set(merged.name, merged)
    upsertCharacter(merged) // 観測できたキャラクターだけ永続化する
  }

  const characters = [...byName.values()]
  const characterOrder = getCharacterOrder()

  const watchedNames = new Set(getWatchedItemNames())
  const trackedCounts = extractTrackedItemCounts(characters, watchedNames)
  if (trackedCounts.size > 0) upsertTrackedItemRecords(trackedCounts)

  return { characters, sourcePath: DNF_TRC_PATH, parsedAt: new Date().toISOString(), characterOrder }
}

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.arad.inventory-manager')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // ファイルダイアログでテキストを開くのではなく、DNF.trc を直接復号して読み込む。
  ipcMain.handle('inventory:openFile', async (): Promise<ParseResult | null> => {
    return loadInventory()
  })

  // DNF.trc の変更を監視し、更新があれば再読み込みしてレンダラーへ通知する。
  // watchTrc 側で前回読み込みから 1 秒のスロットルがかかる。
  trcWatcher = watchTrc(async () => {
    try {
      const result = await loadInventory()
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send('inventory:updated', result)
      }
    } catch (e) {
      console.error('[trc] 自動再読み込みに失敗:', e)
    }
  })

  ipcMain.handle('inventory:saveOrder', async (_event, order: string[]): Promise<void> => {
    saveCharacterOrder(order)
  })

  ipcMain.handle('inventory:parseText', async (_event, text: string): Promise<ParseResult> => {
    return parseTraceLog(text)
  })

  // キャラクター名の左に表示するプレフィクス（D／B）を保存する
  ipcMain.handle('inventory:setPrefix', async (_event, name: string, prefix: string): Promise<void> => {
    saveCharacterPrefix(name, prefix)
  })

  // キャラクターのデータを DB から完全に削除する
  ipcMain.handle('inventory:deleteCharacter', async (_event, name: string): Promise<void> => {
    deleteCharacter(name)
  })

  // 監視対象アイテムの日次記録一覧（AM6:00 境界のゲーム日ごと）
  ipcMain.handle('trackedItems:getRecords', async () => {
    return getTrackedItemRecords()
  })

  // 監視対象アイテム名の一覧
  ipcMain.handle('trackedItems:list', async () => {
    return getWatchedItemNames()
  })

  // 監視対象アイテムを追加
  ipcMain.handle('trackedItems:add', async (_event, name: string) => {
    addWatchedItem(name)
    return getWatchedItemNames()
  })

  // 監視対象アイテムを削除（過去の記録は残す）
  ipcMain.handle('trackedItems:remove', async (_event, name: string) => {
    removeWatchedItem(name)
    return getWatchedItemNames()
  })

  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('will-quit', () => {
  trcWatcher?.close()
  trcWatcher = null
  closeDb()
})
