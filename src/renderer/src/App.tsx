import { useEffect, useMemo, useRef, useState } from 'react'
import { CalendarClock, PanelLeft, Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table'
import type { CharacterInventory, InventoryItem, ItemList, ParseResult } from '@shared/types'
import { TrackedItemRecordsView } from './TrackedItemRecordsView'

function toSearchKey(s: string): string {
  return s.toLowerCase().replace(/[\u3041-\u3096]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) + 0x60)
  )
}

const ALL_STORAGES = '__all__'
// 全キャラクター共通のリストは、キャラクターごとではなく単独のエントリとして扱う。
// storage はパーサが付ける位置ラベル、name はサイドバー等での表示名。
const SHARED_DEFS: { storage: string; name: string }[] = [
  { storage: 'リスト1', name: 'アカウント金庫' },
  { storage: 'リスト9', name: 'キューブ・ソウル' }
]
const SHARED_NAMES = new Set(SHARED_DEFS.map((d) => d.name))

// この幅未満になるとサイドバーを自動的に閉じる
const SIDEBAR_AUTO_CLOSE_WIDTH = 768

function App(): React.JSX.Element {
  const [result, setResult] = useState<ParseResult | null>(null)
  const [selectedName, setSelectedName] = useState<string | null>(null)
  const [storageFilter, setStorageFilter] = useState<string>(ALL_STORAGES)
  // 全タブ（全エントリ）を横断するグローバル検索。
  const [globalSearch, setGlobalSearch] = useState('')
  const [sidebarSearch, setSidebarSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [showTrackedItems, setShowTrackedItems] = useState(false)
  const [characterOrder, setCharacterOrder] = useState<string[]>([])
  const [dropIndicator, setDropIndicator] = useState<{
    name: string
    position: 'before' | 'after'
  } | null>(null)
  const [contextMenu, setContextMenu] = useState<{
    x: number
    y: number
    name: string
  } | null>(null)
  // refreshResult が別バッチで動作しても prefix を参照できるよう ref にも保持する
  const prefixOverrides = useRef<Map<string, string>>(new Map())

  async function handleSetPrefix(name: string, prefix: string): Promise<void> {
    setContextMenu(null)
    prefixOverrides.current.set(name, prefix)
    setResult((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        characters: prev.characters.map((c) => (c.name === name ? { ...c, prefix } : c))
      }
    })
    await window.api.setPrefix(name, prefix)
  }

  async function handleDeleteCharacter(name: string): Promise<void> {
    setContextMenu(null)
    if (!window.confirm(`「${name}」のデータを削除しますか？この操作は取り消せません。`)) return
    prefixOverrides.current.delete(name)
    setResult((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        characters: prev.characters.filter((c) => c.name !== name)
      }
    })
    setCharacterOrder((prev) => prev.filter((n) => n !== name))
    await window.api.deleteCharacter(name)
  }

  // 右クリックメニューを閉じる
  useEffect(() => {
    if (!contextMenu) return
    function close(): void {
      setContextMenu(null)
    }
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [contextMenu])

  function applyResult(res: ParseResult | null): void {
    if (!res) return
    setResult(res)
    const firstShared = SHARED_DEFS.find((d) =>
      res.characters.some((c) => c.lists.some((l) => l.storage === d.storage))
    )
    setSelectedName(firstShared ? firstShared.name : (res.characters[0]?.name ?? null))
    setStorageFilter(ALL_STORAGES)
    if (res.characters.length === 0) setError('キャラクターデータが見つかりませんでした。')
    else setError(null)
  }

  // 自動再読み込み（DNF.trc の変更検知）では、選択中のキャラクターや検索条件を
  // リセットせずにデータだけ差し替える。
  // ただし手動で設定された prefix は ref から復元する（setPrefix → refreshResult の競合対策）。
  function refreshResult(res: ParseResult): void {
    const ov = prefixOverrides.current
    setResult({
      ...res,
      characters: res.characters.map((c) => ({
        ...c,
        prefix: ov.has(c.name) ? ov.get(c.name)! : c.prefix
      }))
    })
    setError(res.characters.length === 0 ? 'キャラクターデータが見つかりませんでした。' : null)
  }

  async function handleOpenFile(): Promise<void> {
    setLoading(true)
    setError(null)
    try {
      const res = await window.api.openFile()
      if (res) applyResult(res)
    } catch (e) {
      setError(`ファイルの読み込みに失敗しました: ${String(e)}`)
    } finally {
      setLoading(false)
    }
  }

  // ウィンドウ幅がしきい値の境界をまたいだときにサイドバーを自動開閉する。
  // 境界をまたいだ瞬間だけ切り替えるので、同じ幅帯の中では手動トグルが尊重される。
  useEffect(() => {
    let wasNarrow = window.innerWidth < SIDEBAR_AUTO_CLOSE_WIDTH
    if (wasNarrow) setSidebarOpen(false)
    function handleResize(): void {
      const isNarrow = window.innerWidth < SIDEBAR_AUTO_CLOSE_WIDTH
      if (isNarrow !== wasNarrow) {
        wasNarrow = isNarrow
        setSidebarOpen(!isNarrow)
      }
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  // 起動時に DNF.trc を自動で読み込み、以降は変更検知で自動再読み込みする。
  useEffect(() => {
    void handleOpenFile()
    const unsubscribe = window.api.onUpdate((res) => refreshResult(res))
    return unsubscribe
    // マウント時に一度だけ実行する
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // キャラクター並び順をエントリと同期（DB から読んだ順をベースに、新規キャラは末尾へ）
  useEffect(() => {
    if (!result) return
    const charNames = entries.filter((e) => !SHARED_NAMES.has(e.name)).map((e) => e.name)
    setCharacterOrder((prev) => {
      // 現在の並び順（ドラッグ操作等で確定済み）を優先し、DB の並び順は
      // まだ prev に含まれていない名前（初回読み込みや新規キャラ）の位置決めにのみ使う。
      // こうしないと、並び順に無関係な result 更新（タイプ変更など）のたびに
      // 最後にファイルを読み込んだ時点の古い並び順へ巻き戻ってしまう。
      const existing = prev.filter((n) => charNames.includes(n))
      const base = (result.characterOrder ?? []).filter(
        (n) => charNames.includes(n) && !existing.includes(n)
      )
      const newNames = charNames.filter((n) => !base.includes(n) && !existing.includes(n))
      const merged = [...existing, ...base, ...newNames]
      if (merged.length === prev.length && merged.every((n, i) => n === prev[i])) return prev
      return merged
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result])

  // 並び順が変わったら DB に保存
  useEffect(() => {
    if (characterOrder.length > 0) void window.api.saveOrder(characterOrder)
  }, [characterOrder])

  // 共有リスト（アカウント金庫・キューブ・ソウル）を各キャラクターから抜き出し、
  // それぞれ単独のエントリとしてまとめる
  const { entries, characterCount } = useMemo(() => {
    if (!result) return { entries: [] as CharacterInventory[], characterCount: 0 }
    const sharedLists = new Map<string, ItemList>()
    const characters = result.characters.map((c) => {
      const own: ItemList[] = []
      for (const list of c.lists) {
        const def = SHARED_DEFS.find((d) => d.storage === list.storage)
        if (def) {
          const prev = sharedLists.get(def.storage)
          if (!prev || list.items.length > prev.items.length) sharedLists.set(def.storage, list)
          continue
        }
        own.push(list)
      }
      const totalItems = own.reduce((n, l) => n + l.items.length, 0)
      return { ...c, lists: own, totalItems }
    })
    const sharedEntries: CharacterInventory[] = []
    for (const def of SHARED_DEFS) {
      const list = sharedLists.get(def.storage)
      if (list) {
        sharedEntries.push({
          name: def.name,
          time: '',
          lists: [{ ...list, storage: def.name }],
          totalItems: list.items.length,
          prefix: ''
        })
      }
    }
    return {
      entries: [...sharedEntries, ...characters],
      characterCount: characters.length
    }
  }, [result])

  // characterOrder に従って並び替えたエントリ（共有エントリは常に先頭）
  const orderedEntries = useMemo(() => {
    const shared = entries.filter((e) => SHARED_NAMES.has(e.name))
    const chars = entries.filter((e) => !SHARED_NAMES.has(e.name))
    const orderMap = new Map(characterOrder.map((name, i) => [name, i]))
    chars.sort((a, b) => (orderMap.get(a.name) ?? Infinity) - (orderMap.get(b.name) ?? Infinity))
    return [...shared, ...chars]
  }, [entries, characterOrder])

  // 自動再読み込み後に選択中のキャラクターが消えていたら、先頭のエントリへ退避する。
  useEffect(() => {
    if (entries.length === 0) return
    if (!selectedName || !entries.some((c) => c.name === selectedName)) {
      setSelectedName(entries[0].name)
      setStorageFilter(ALL_STORAGES)
    }
  }, [entries, selectedName])

  const selected: CharacterInventory | null = useMemo(() => {
    if (!selectedName) return null
    return entries.find((c) => c.name === selectedName) ?? null
  }, [entries, selectedName])

  const storages = useMemo(() => {
    if (!selected) return []
    return [...new Set(selected.lists.map((l) => l.storage))]
  }, [selected])

  const rows = useMemo(() => {
    if (!selected) return []
    // グローバル検索が有効なら、表もそのクエリ（アイテム名または ID）で絞り込む。
    const g = toSearchKey(globalSearch.trim())
    return selected.lists
      .filter((l) => storageFilter === ALL_STORAGES || l.storage === storageFilter)
      .flatMap((l) => l.items.map((item) => ({ ...item, storage: l.storage })))
      .filter(
        (item) => g === '' || toSearchKey(item.name).includes(g) || String(item.itemId).includes(g)
      )
  }, [selected, storageFilter, globalSearch])

  // グローバル検索: 全エントリを横断し、アイテム名または ID が一致するエントリ名の集合を返す。
  // 未入力時は null（ハイライトなし）。値はサイドバーのタブをハイライトするために使う。
  const globalMatches = useMemo<Set<string> | null>(() => {
    const q = toSearchKey(globalSearch.trim())
    if (q === '') return null
    const names = new Set<string>()
    for (const entry of entries) {
      const hit = entry.lists.some((l) =>
        l.items.some(
          (item) => toSearchKey(item.name).includes(q) || String(item.itemId).includes(q)
        )
      )
      if (hit) names.add(entry.name)
    }
    return names
  }, [entries, globalSearch])

  // 全キャラクター横断のアイテム検索結果。
  const searchResults = useMemo<
    Array<{ name: string; items: Array<InventoryItem & { storage: string }> }> | null
  >(() => {
    const q = toSearchKey(globalSearch.trim())
    if (q === '') return null
    const results: Array<{
      name: string
      items: Array<InventoryItem & { storage: string }>
    }> = []
    for (const entry of orderedEntries) {
      const items = entry.lists.flatMap((l) =>
        l.items
          .filter(
            (item) =>
              toSearchKey(item.name).includes(q) || String(item.itemId).includes(q)
          )
          .map((item) => ({ ...item, storage: l.storage }))
      )
      if (items.length > 0) results.push({ name: entry.name, items })
    }
    return results
  }, [orderedEntries, globalSearch])

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <header className="flex items-center gap-3 border-b px-6 py-3">
        {result && (
          <button
            onClick={() => setSidebarOpen((v) => !v)}
            aria-label={sidebarOpen ? 'サイドバーを閉じる' : 'サイドバーを開く'}
            aria-pressed={sidebarOpen}
            className="hover:bg-accent hover:text-accent-foreground text-muted-foreground -ml-2 rounded-md p-2 transition-colors"
          >
            <PanelLeft className="size-5" />
          </button>
        )}
        <div className="mr-auto">
          <h1 className="text-lg font-bold tracking-tight">Arad Inventory Manager</h1>
          <p className="text-muted-foreground text-xs">
            {result
              ? `${characterCount} キャラクター読み込み済み`
              : 'トレースログを読み込んでください'}
          </p>
        </div>
        {result && !showTrackedItems && (
          <div className="relative w-72">
            <Search className="text-muted-foreground pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2" />
            <Input
              className="pl-8"
              placeholder="全タブを横断して検索…"
              value={globalSearch}
              onChange={(e) => setGlobalSearch(e.target.value)}
            />
            {searchResults && (
              <span className="text-muted-foreground absolute right-2.5 top-1/2 -translate-y-1/2 text-xs tabular-nums">
                {searchResults.reduce((n, r) => n + r.items.length, 0)} 件
              </span>
            )}
          </div>
        )}
        {result && (
          <button
            onClick={() => setShowTrackedItems((v) => !v)}
            aria-pressed={showTrackedItems}
            className={cn(
              'flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm transition-colors',
              showTrackedItems
                ? 'bg-primary text-primary-foreground border-transparent'
                : 'hover:bg-accent'
            )}
          >
            <CalendarClock className="size-4" />
            履歴
          </button>
        )}
      </header>

      {error && (
        <div className="border-b bg-destructive/10 px-6 py-2 text-sm text-destructive">{error}</div>
      )}

      {contextMenu && (
        <div
          className="fixed inset-0 z-50"
          onClick={() => setContextMenu(null)}
          onContextMenu={(e) => {
            e.preventDefault()
            setContextMenu(null)
          }}
        >
          <div
            className="absolute flex min-w-32 flex-col rounded-md border bg-popover p-1 shadow-md"
            style={{ left: contextMenu.x, top: contextMenu.y }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-3 pb-1 pt-1.5 text-xs font-medium text-muted-foreground">タイプ</div>
            <button
              onClick={() => handleSetPrefix(contextMenu.name, 'D')}
              className={cn(
                'flex items-center gap-2 rounded-sm px-3 py-1.5 text-sm transition-colors hover:bg-accent',
                result?.characters.find((c) => c.name === contextMenu.name)?.prefix === 'D' &&
                  'bg-accent font-medium'
              )}
            >
              <span className="inline-flex size-4 items-center justify-center rounded bg-red-500 text-[10px] font-bold text-white">D</span>
              D
            </button>
            <button
              onClick={() => handleSetPrefix(contextMenu.name, 'B')}
              className={cn(
                'flex items-center gap-2 rounded-sm px-3 py-1.5 text-sm transition-colors hover:bg-accent',
                result?.characters.find((c) => c.name === contextMenu.name)?.prefix === 'B' &&
                  'bg-accent font-medium'
              )}
            >
              <span className="inline-flex size-4 items-center justify-center rounded bg-emerald-500 text-[10px] font-bold text-white">B</span>
              B
            </button>
            <button
              onClick={() => handleSetPrefix(contextMenu.name, '')}
              className={cn(
                'flex items-center gap-2 rounded-sm px-3 py-1.5 text-sm transition-colors hover:bg-accent',
                (!result?.characters.find((c) => c.name === contextMenu.name)?.prefix) &&
                  'bg-accent font-medium'
              )}
            >
              なし
            </button>
            <div className="my-1 h-px bg-border" />
            <button
              onClick={() => handleDeleteCharacter(contextMenu.name)}
              className="flex items-center gap-2 rounded-sm px-3 py-1.5 text-sm text-destructive transition-colors hover:bg-destructive/10"
            >
              データ削除
            </button>
          </div>
        </div>
      )}
      {!result ? (
        <EmptyState loading={loading} />
      ) : showTrackedItems ? (
        <TrackedItemRecordsView />
      ) : (
        <div className="flex min-h-0 flex-1">
          <aside
            className={cn(
              'shrink-0 overflow-hidden border-r transition-[width] duration-200',
              sidebarOpen ? 'w-56' : 'w-0 border-r-0'
            )}
          >
            <div className="flex h-full w-56 flex-col">
              <div className="shrink-0 p-2 pb-1">
                <div className="relative">
                  <Search className="text-muted-foreground pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2" />
                  <Input
                    className="pl-8"
                    placeholder="キャラクター検索…"
                    value={sidebarSearch}
                    onChange={(e) => setSidebarSearch(e.target.value)}
                  />
                </div>
              </div>
              <ul className="flex-1 overflow-y-auto p-2 pt-1">
                {orderedEntries
                  .filter((c) => {
                    const q = toSearchKey(sidebarSearch.trim())
                    return q === '' || toSearchKey(c.name).includes(q)
                  })
                  .map((c) => {
                const isShared = SHARED_NAMES.has(c.name)
                const isMatch = globalMatches?.has(c.name) ?? false
                const isDimmed = globalMatches !== null && !isMatch
                const dropPos = dropIndicator?.name === c.name ? dropIndicator.position : null
                return (
                  <li
                    key={c.name}
                    className="relative"
                    onContextMenu={(e) => {
                      if (isShared) return
                      e.preventDefault()
                      setContextMenu({ x: e.clientX, y: e.clientY, name: c.name })
                    }}
                    draggable={!isShared}
                    onDragStart={(e) => {
                      e.dataTransfer.effectAllowed = 'move'
                      e.dataTransfer.setData('text/plain', c.name)
                    }}
                    onDragOver={(e) => {
                      if (isShared) return
                      e.preventDefault()
                      e.dataTransfer.dropEffect = 'move'
                      const rect = e.currentTarget.getBoundingClientRect()
                      const y = e.clientY - rect.top
                      const position = y < rect.height / 2 ? 'before' : 'after'
                      e.currentTarget.dataset.dropPosition = position
                      setDropIndicator({ name: c.name, position })
                    }}
                    onDragLeave={(e) => {
                      if (e.currentTarget.contains(e.relatedTarget as Node)) return
                      setDropIndicator(null)
                    }}
                    onDrop={(e) => {
                      e.preventDefault()
                      if (isShared) return
                      const fromName = e.dataTransfer.getData('text/plain')
                      if (!fromName || fromName === c.name) return
                      const position = e.currentTarget.dataset
                        .dropPosition as 'before' | 'after' | undefined
                      setCharacterOrder((prev) => {
                        const newOrder = [...prev]
                        const fromIdx = newOrder.indexOf(fromName)
                        const toIdx = newOrder.indexOf(c.name)
                        if (fromIdx === -1 || toIdx === -1) return prev
                        newOrder.splice(fromIdx, 1)
                        let insertAt = toIdx
                        if (fromIdx < toIdx) insertAt--
                        if (position === 'after') insertAt++
                        newOrder.splice(insertAt, 0, fromName)
                        return newOrder
                      })
                      setDropIndicator(null)
                    }}
                    onDragEnd={() => setDropIndicator(null)}
                  >
                    {dropPos === 'before' && (
                      <div className="absolute -top-px left-2 right-2 z-10 h-0.5 rounded-full bg-primary" />
                    )}
                    <button
                      onClick={() => {
                        setSelectedName(c.name)
                        setStorageFilter(ALL_STORAGES)
                      }}
                      className={cn(
                        'flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm transition-colors',
                        selectedName === c.name
                          ? 'bg-accent text-accent-foreground'
                          : 'hover:bg-accent/50',
                        isShared && 'mb-1 font-medium',
                        isMatch && 'ring-primary bg-primary/10 ring-2 ring-inset',
                        isDimmed && 'opacity-40',
                        !isShared && 'cursor-grab active:cursor-grabbing'
                      )}
                    >
                      <span className="flex min-w-0 items-center gap-1">
                        {!isShared && c.prefix && (
                          <span
                            className={cn(
                              'inline-flex size-4 shrink-0 items-center justify-center rounded text-[10px] font-bold text-white',
                              c.prefix === 'D' && 'bg-red-500',
                              c.prefix === 'B' && 'bg-emerald-500'
                            )}
                          >
                            {c.prefix}
                          </span>
                        )}
                        {isShared && <span className="mr-1">🏦</span>}
                        <span className="truncate">{c.name}</span>
                      </span>
                      <Badge variant={isShared ? 'default' : 'secondary'} className="ml-2">
                        {c.totalItems}
                      </Badge>
                    </button>
                    {dropPos === 'after' && (
                      <div className="absolute -bottom-px left-2 right-2 z-10 h-0.5 rounded-full bg-primary" />
                    )}
                  </li>
                )
              })}
            </ul>
            </div>
          </aside>

          <main className="flex min-w-0 flex-1 flex-col">
            {searchResults !== null ? (
              <>
                <div className="flex flex-wrap items-center gap-2 border-b px-6 py-3">
                  <h2 className="mr-2 text-base font-semibold">アイテム検索結果</h2>
                  <Badge variant="outline">
                    {searchResults.reduce((n, r) => n + r.items.length, 0)} 件
                  </Badge>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
                  {searchResults.length === 0 ? (
                    <div className="py-8 text-center text-muted-foreground">
                      該当するアイテムがありません
                    </div>
                  ) : (
                    <div className="space-y-6">
                      {searchResults.map((r) => {
                        const entry = entries.find((e) => e.name === r.name)
                        return (
                          <div key={r.name}>
                            <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
                              {entry?.prefix && (
                                <span
                                  className={cn(
                                    'inline-flex size-4 items-center justify-center rounded text-[10px] font-bold text-white',
                                    entry.prefix === 'D' && 'bg-red-500',
                                    entry.prefix === 'B' && 'bg-emerald-500'
                                  )}
                                >
                                  {entry.prefix}
                                </span>
                              )}
                              {r.name}
                              <Badge variant="secondary">{r.items.length}</Badge>
                            </h3>
                            <Table className="table-fixed">
                              <TableHeader>
                                <TableRow>
                                  <TableHead className="w-auto">アイテム名</TableHead>
                                  <TableHead className="w-[140px]">保管場所</TableHead>
                                  <TableHead className="w-[100px] text-right">所持数</TableHead>
                                  <TableHead className="w-[80px]">状態</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {r.items.map((item, i) => (
                                  <TableRow
                                    key={`${r.name}-${item.storage}-${item.slotIndex}-${item.itemId}-${i}`}
                                  >
                                    <TableCell className="truncate font-medium">{item.name}</TableCell>
                                    <TableCell className="truncate">{item.storage}</TableCell>
                                    <TableCell className="text-right font-mono tabular-nums">
                                      {item.data.toLocaleString()}
                                    </TableCell>
                                    <TableCell>
                                      {item.isSealed && (
                                        <Badge variant="destructive" className="mr-1">
                                          封印
                                        </Badge>
                                      )}
                                      {item.amplifyValue > 0 && (
                                        <Badge variant="default">+{item.amplifyValue}</Badge>
                                      )}
                                    </TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              </>
            ) : selected ? (
              <>
                <div className="flex flex-wrap items-center gap-2 border-b px-6 py-3">
                  <h2 className="mr-2 flex items-center gap-1 text-base font-semibold">
                    {selected.prefix && (
                      <span
                        className={cn(
                          'inline-flex size-5 items-center justify-center rounded text-xs font-bold text-white',
                          selected.prefix === 'D' && 'bg-red-500',
                          selected.prefix === 'B' && 'bg-emerald-500'
                        )}
                      >
                        {selected.prefix}
                      </span>
                    )}
                    {selected.name}
                  </h2>
                  <Badge variant="outline">{rows.length} 件表示</Badge>
                </div>

                <div className="flex flex-wrap gap-1.5 border-b px-6 py-2">
                  <StorageChip
                    label={`すべて (${selected.totalItems})`}
                    active={storageFilter === ALL_STORAGES}
                    onClick={() => setStorageFilter(ALL_STORAGES)}
                  />
                  {storages.map((s) => {
                    const count = selected.lists
                      .filter((l) => l.storage === s)
                      .reduce((n, l) => n + l.items.length, 0)
                    return (
                      <StorageChip
                        key={s}
                        label={`${s} (${count})`}
                        active={storageFilter === s}
                        onClick={() => setStorageFilter(s)}
                      />
                    )
                  })}
                </div>

                <div className="min-h-0 flex-1 px-6 py-4">
                  <Table containerClassName="h-full overflow-auto" className="table-fixed">
                    <TableHeader className="sticky top-0 z-10 bg-background">
                      <TableRow>
                        <TableHead className="w-auto">アイテム名</TableHead>
                        <TableHead className="w-[100px] text-right">所持数</TableHead>
                        <TableHead className="w-[80px]">状態</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map((item, i) => (
                        <TableRow key={`${item.storage}-${item.slotIndex}-${item.itemId}-${i}`}>
                          <TableCell className="truncate font-medium">{item.name}</TableCell>
                          <TableCell className="text-right font-mono tabular-nums">
                            {item.data.toLocaleString()}
                          </TableCell>
                          <TableCell>
                            {item.isSealed && (
                              <Badge variant="destructive" className="mr-1">
                                封印
                              </Badge>
                            )}
                            {item.amplifyValue > 0 && (
                              <Badge variant="default">+{item.amplifyValue}</Badge>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                      {rows.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={3} className="py-8 text-center text-muted-foreground">
                            該当するアイテムがありません
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              </>
            ) : null}
          </main>
        </div>
      )}
    </div>
  )
}

function StorageChip({
  label,
  active,
  onClick
}: {
  label: string
  active: boolean
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      onClick={onClick}
      className={cn(
        'rounded-full border px-3 py-1 text-xs transition-colors',
        active ? 'bg-primary text-primary-foreground border-transparent' : 'hover:bg-accent'
      )}
    >
      {label}
    </button>
  )
}

function EmptyState({ loading }: { loading: boolean }): React.JSX.Element {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
      <div className="text-muted-foreground">
        <p className="text-lg font-medium">
          {loading ? '読み込み中…' : 'インベントリログを読み込みましょう'}
        </p>
        <p className="text-sm">
          DNF.trc を読み込むと、キャラクターごとの所持品が表示されます。
        </p>
      </div>
    </div>
  )
}

export default App
