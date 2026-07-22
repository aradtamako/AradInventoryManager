import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'

// DNF.trc のパス（実行中ユーザーのホームディレクトリから解決）
export const DNF_TRC_PATH = join(homedir(), 'AppData', 'LocalLow', 'DNF', 'DNF.trc')

function rol(b: number, n: number): number {
  return ((b << n) | (b >> (8 - n))) & 0xff
}

// 各バイトの変換テーブル（256エントリ）
const TAB = Uint8Array.from({ length: 256 }, (_, b) => rol(b ^ 0x9d, 2))

// trc 形式では 0x5E が 0x42 0x5E の2バイトに退避される。
// 復号後に余分な 0x42 を取り除かないと SJIS 文字や '^' が壊れて文字化けする。
function unescape5e(buf: Uint8Array): Uint8Array {
  const out = new Uint8Array(buf.length)
  let j = 0
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === 0x42 && i + 1 < buf.length && buf[i + 1] === 0x5e) {
      // 0x42 を捨てて、次ループで 0x5e を書き込む
      continue
    }
    out[j++] = buf[i]
  }
  return out.subarray(0, j)
}

const decoder = new TextDecoder('shift_jis', { fatal: false })

// DNF.trc を読み込み、復号して cp932(Shift_JIS) テキストを返す
export async function decodeTrc(path = DNF_TRC_PATH): Promise<string> {
  const raw = await readFile(path)
  const dec = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) dec[i] = TAB[raw[i]]
  return decoder.decode(unescape5e(dec))
}

export interface TrcWatcher {
  close: () => void
}

// DNF.trc を監視し、変更があるたびに onReload を呼ぶ。
//
// fs.watch(ReadDirectoryChangesW) は、ゲームがメモリマップド I/O やバッファ書き込みで
// 更新する場合に変更通知を出さないことがあるため使わない。代わりに一定間隔で stat し、
// サイズ・更新時刻の変化を検知するポーリング方式にする（ゲーム書き込みでも確実）。
//
// DNF.trc は自動的に頻繁に書き込まれ得るため、実際の再読み込みは
// 前回実行から最低 delayMs（既定 1 秒）空けてスロットルする。
export function watchTrc(
  onReload: () => void,
  path = DNF_TRC_PATH,
  delayMs = 1000
): TrcWatcher {
  let lastSig: string | null = null // 直近に観測したファイルの署名（サイズ:更新時刻）
  let lastRun = 0
  let pending: NodeJS.Timeout | null = null
  let stopped = false

  const schedule = (): void => {
    if (pending) return // 既に次回読み込みを予約済み
    const wait = Math.max(0, delayMs - (Date.now() - lastRun))
    pending = setTimeout(() => {
      pending = null
      lastRun = Date.now()
      onReload()
    }, wait)
  }

  const poll = async (): Promise<void> => {
    if (stopped) return
    try {
      const st = await stat(path)
      const sig = `${st.size}:${st.mtimeMs}`
      if (lastSig === null) {
        // 初回は基準値を記録するだけ（起動時読み込みと二重にしない）
        lastSig = sig
      } else if (sig !== lastSig) {
        lastSig = sig
        schedule()
      }
    } catch {
      // 一時的に読めない（書き込み中・不在）場合は次回ポーリングで再試行
    }
  }

  const interval = setInterval(() => void poll(), 1000)
  void poll() // 起動直後に基準値を取得

  return {
    close: () => {
      stopped = true
      clearInterval(interval)
      if (pending) clearTimeout(pending)
    }
  }
}
