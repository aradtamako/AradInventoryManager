import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type { DailyTrackedItemRecord, ParseResult } from '../shared/types'

const api = {
  openFile: (): Promise<ParseResult | null> => ipcRenderer.invoke('inventory:openFile'),
  parseText: (text: string): Promise<ParseResult> =>
    ipcRenderer.invoke('inventory:parseText', text),
  saveOrder: (order: string[]): Promise<void> =>
    ipcRenderer.invoke('inventory:saveOrder', order),
  setPrefix: (name: string, prefix: string): Promise<void> =>
    ipcRenderer.invoke('inventory:setPrefix', name, prefix),
  deleteCharacter: (name: string): Promise<void> =>
    ipcRenderer.invoke('inventory:deleteCharacter', name),
  getTrackedItemRecords: (): Promise<DailyTrackedItemRecord[]> =>
    ipcRenderer.invoke('trackedItems:getRecords'),
  listWatchedItems: (): Promise<string[]> => ipcRenderer.invoke('trackedItems:list'),
  addWatchedItem: (name: string): Promise<string[]> =>
    ipcRenderer.invoke('trackedItems:add', name),
  removeWatchedItem: (name: string): Promise<string[]> =>
    ipcRenderer.invoke('trackedItems:remove', name),
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
