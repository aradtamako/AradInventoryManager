import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type { ParseResult } from '../shared/types'

const api = {
  openFile: (): Promise<ParseResult | null> => ipcRenderer.invoke('inventory:openFile'),
  parseText: (text: string): Promise<ParseResult> =>
    ipcRenderer.invoke('inventory:parseText', text),
  saveOrder: (order: string[]): Promise<void> =>
    ipcRenderer.invoke('inventory:saveOrder', order),
  // DNF.trc が変更され自動再読み込みされたときに呼ばれる。返り値は購読解除関数。
  onUpdate: (callback: (result: ParseResult) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, result: ParseResult): void => callback(result)
    ipcRenderer.on('inventory:updated', listener)
    return () => ipcRenderer.removeListener('inventory:updated', listener)
  }
}

export type InventoryApi = typeof api

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
