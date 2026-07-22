import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'node:path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { mergeCharacter, parseTraceLog } from '../shared/parser'
import { decodeTrc, watchTrc, type TrcWatcher, DNF_TRC_PATH } from './trc'
import { closeDb, getStoredCharacters, upsertCharacter } from './db'
import type { CharacterInventory, ParseResult } from '../shared/types'

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

  const characters = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name, 'ja'))
  return { characters, sourcePath: DNF_TRC_PATH, parsedAt: new Date().toISOString() }
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

  ipcMain.handle('inventory:parseText', async (_event, text: string): Promise<ParseResult> => {
    return parseTraceLog(text)
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
