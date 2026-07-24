import { useEffect, useMemo, useState } from 'react'
import { PanelLeft, Search } from 'lucide-react'
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
import type { CharacterInventory, ItemList, ParseResult } from '@shared/types'

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
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(true)

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
  function refreshResult(res: ParseResult): void {
    setResult(res)
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
          totalItems: list.items.length
        })
      }
    }
    return {
      entries: [...sharedEntries, ...characters],
      characterCount: characters.length
    }
  }, [result])

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
    const g = globalSearch.trim().toLowerCase()
    return selected.lists
      .filter((l) => storageFilter === ALL_STORAGES || l.storage === storageFilter)
      .flatMap((l) => l.items.map((item) => ({ ...item, storage: l.storage })))
      .filter(
        (item) =>
          g === '' || item.name.toLowerCase().includes(g) || String(item.itemId).includes(g)
      )
  }, [selected, storageFilter, globalSearch])

  // グローバル検索: 全エントリを横断し、アイテム名または ID が一致するエントリ名の集合を返す。
  // 未入力時は null（ハイライトなし）。値はサイドバーのタブをハイライトするために使う。
  const globalMatches = useMemo<Set<string> | null>(() => {
    const q = globalSearch.trim().toLowerCase()
    if (q === '') return null
    const names = new Set<string>()
    for (const entry of entries) {
      const hit = entry.lists.some((l) =>
        l.items.some(
          (item) => item.name.toLowerCase().includes(q) || String(item.itemId).includes(q)
        )
      )
      if (hit) names.add(entry.name)
    }
    return names
  }, [entries, globalSearch])

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
        {result && (
          <div className="relative w-72">
            <Search className="text-muted-foreground pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2" />
            <Input
              className="pl-8"
              placeholder="全タブを横断して検索…"
              value={globalSearch}
              onChange={(e) => setGlobalSearch(e.target.value)}
            />
            {globalMatches && (
              <span className="text-muted-foreground absolute right-2.5 top-1/2 -translate-y-1/2 text-xs tabular-nums">
                {globalMatches.size} 件
              </span>
            )}
          </div>
        )}
      </header>

      {error && (
        <div className="border-b bg-destructive/10 px-6 py-2 text-sm text-destructive">{error}</div>
      )}

      {!result ? (
        <EmptyState loading={loading} />
      ) : (
        <div className="flex min-h-0 flex-1">
          <aside
            className={cn(
              'shrink-0 overflow-hidden border-r transition-[width] duration-200',
              sidebarOpen ? 'w-56' : 'w-0 border-r-0'
            )}
          >
            <ul className="h-full w-56 overflow-y-auto p-2">
              {entries.map((c) => {
                const isShared = SHARED_NAMES.has(c.name)
                const isMatch = globalMatches?.has(c.name) ?? false
                const isDimmed = globalMatches !== null && !isMatch
                return (
                  <li key={c.name}>
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
                        isDimmed && 'opacity-40'
                      )}
                    >
                      <span className="truncate">
                        {isShared && <span className="mr-1">🏦</span>}
                        {c.name}
                      </span>
                      <Badge variant={isShared ? 'default' : 'secondary'} className="ml-2">
                        {c.totalItems}
                      </Badge>
                    </button>
                  </li>
                )
              })}
            </ul>
          </aside>

          <main className="flex min-w-0 flex-1 flex-col">
            {selected && (
              <>
                <div className="flex flex-wrap items-center gap-2 border-b px-6 py-3">
                  <h2 className="mr-2 text-base font-semibold">{selected.name}</h2>
                  <Badge variant="outline">{rows.length} 件表示</Badge>
                  <Input
                    className="ml-auto w-64"
                    placeholder="アイテム名で検索…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
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
                  <Table containerClassName="h-full overflow-auto">
                    <TableHeader className="sticky top-0 z-10 bg-background">
                      <TableRow>
                        <TableHead>アイテム名</TableHead>
                        <TableHead className="text-right">所持数</TableHead>
                        <TableHead>状態</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map((item, i) => (
                        <TableRow key={`${item.storage}-${item.slotIndex}-${item.itemId}-${i}`}>
                          <TableCell className="font-medium">{item.name}</TableCell>
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
            )}
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
