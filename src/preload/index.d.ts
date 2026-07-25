import { ElectronAPI } from '@electron-toolkit/preload'
import type { InventoryApi } from './index'

export type { InventoryApi }

declare global {
  interface Window {
    electron: ElectronAPI
    api: InventoryApi
  }
}
