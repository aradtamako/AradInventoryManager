import { useEffect, useMemo, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig
} from '@/components/ui/chart'
import { DatePicker } from '@/components/DatePicker'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table'
import type { DailyTrackedItemCharacterRecord, DailyTrackedItemRecord } from '@shared/types'

// アイテムごとの折れ線に割り当てる色（監視アイテム数がこれより多い場合は循環させる）。
const CHART_PALETTE = [
  '#34d399',
  '#38bdf8',
  '#fbbf24',
  '#a78bfa',
  '#fb7185',
  '#22d3ee',
  '#a3e635',
  '#fb923c'
]

function diffClass(diff: number | null): string {
  return cn(
    'font-mono tabular-nums',
    diff !== null && diff > 0 && 'text-emerald-500',
    diff !== null && diff < 0 && 'text-destructive'
  )
}

function formatDiff(diff: number | null): string {
  return diff === null ? '—' : `${diff > 0 ? '+' : ''}${diff.toLocaleString()}`
}

// 表の列見出し用に MM/DD 形式へ短縮する（date は YYYY-MM-DD）。
function formatDateHeader(date: string): string {
  const [, m, d] = date.split('-')
  return `${m}/${d}`
}

// アイテム名を itemOrder（バッジの並び順）に従って並べる。
// itemOrder に無い名前（削除済みだが履歴が残っているアイテム等）は末尾に五十音順で追加する。
function orderItemNames(names: string[], order: string[]): string[] {
  const orderMap = new Map(order.map((name, i) => [name, i]))
  const known = names
    .filter((n) => orderMap.has(n))
    .sort((a, b) => orderMap.get(a)! - orderMap.get(b)!)
  const unknown = names.filter((n) => !orderMap.has(n)).sort((a, b) => a.localeCompare(b, 'ja'))
  return [...known, ...unknown]
}

// 指定日以前で最も新しいそのアイテムの記録を返す（その日ちょうどの記録が無い場合に使う）。
function latestOnOrBefore(
  history: DailyTrackedItemRecord[],
  date: string
): DailyTrackedItemRecord | null {
  let found: DailyTrackedItemRecord | null = null
  for (const r of history) {
    if (r.date > date) break
    found = r
  }
  return found
}

// AM6:00 を境界としたゲーム日ごとに、監視対象アイテムの所持数と増減を、指定した期間で一覧表示する。
// 監視対象アイテムはユーザーが自由に追加・削除でき、キューブ・ソウル以外の任意のアイテムを追跡できる。
type Tab = 'daily' | 'period' | 'chart'

export function TrackedItemRecordsView({
  characterPrefixes,
  characterOrder
}: {
  // キャラクター名 → prefix（D/B）。バッジのアイコン表示に使う（無ければ非表示）。
  characterPrefixes?: Map<string, string>
  // サイドバーと同じキャラクター表示順。バッジの並び替えに使う（無ければ五十音順）。
  characterOrder?: string[]
}): React.JSX.Element {
  const [records, setRecords] = useState<DailyTrackedItemRecord[] | null>(null)
  const [charRecords, setCharRecords] = useState<DailyTrackedItemCharacterRecord[] | null>(null)
  // 集計対象。'' なら全キャラ合計（records）、それ以外なら該当キャラクターの内訳（charRecords）を使う。
  const [selectedCharacter, setSelectedCharacter] = useState('')
  const [watchedItems, setWatchedItems] = useState<string[] | null>(null)
  const [newItemName, setNewItemName] = useState('')
  const [rangeStart, setRangeStart] = useState('')
  const [rangeEnd, setRangeEnd] = useState('')
  const [tab, setTab] = useState<Tab>('daily')
  // グラフの凡例クリックで非表示にしたアイテム名。
  const [hiddenSeries, setHiddenSeries] = useState<Set<string>>(new Set())
  // バッジのドラッグ並び替えで確定した監視対象アイテムの表示順。表・グラフもこの順序に従う。
  const [itemOrder, setItemOrder] = useState<string[]>([])
  const [dropIndicator, setDropIndicator] = useState<{
    name: string
    position: 'before' | 'after'
  } | null>(null)

  function toggleSeries(name: string): void {
    setHiddenSeries((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  useEffect(() => {
    void window.api.getTrackedItemRecords().then(setRecords)
    void window.api.getTrackedItemCharacterRecords().then(setCharRecords)
    void window.api.listWatchedItems().then(setWatchedItems)
    void window.api.getWatchedItemOrder().then(setItemOrder)
  }, [])

  // キャラクター別記録に登場するキャラクター名。選択肢として使う。
  // characterOrder（サイドバーの並び順）に従い、そこに無い名前は末尾に五十音順で並べる。
  const characterNames = useMemo(() => {
    if (!charRecords) return []
    const names = [...new Set(charRecords.map((r) => r.characterName))]
    return orderItemNames(names, characterOrder ?? [])
  }, [charRecords, characterOrder])

  // 選択中の集計対象（全キャラ合計 or 特定キャラクター）に応じたレコード一覧。
  // 以降の集計（日付一覧・履歴・グラフ等）はすべてこれを土台にする。
  const activeRecords = useMemo<DailyTrackedItemRecord[] | null>(() => {
    if (!selectedCharacter) return records
    if (!charRecords) return null
    return charRecords
      .filter((r) => r.characterName === selectedCharacter)
      .map((r) => ({ date: r.date, itemName: r.itemName, count: r.count, recordedAt: r.recordedAt }))
  }, [records, charRecords, selectedCharacter])

  async function handleAddItem(): Promise<void> {
    const name = newItemName.trim()
    if (!name) return
    setNewItemName('')
    setWatchedItems(await window.api.addWatchedItem(name))
  }

  async function handleRemoveItem(name: string): Promise<void> {
    setWatchedItems(await window.api.removeWatchedItem(name))
    setItemOrder((prev) => prev.filter((n) => n !== name))
  }

  // watchedItems（DB の登録順）を土台に、確定済みの並び順（ドラッグ操作 or DB 由来）を反映する。
  // 新規追加されたアイテムは末尾に、削除されたアイテムは自動的に除外される。
  useEffect(() => {
    if (!watchedItems) return
    setItemOrder((prev) => {
      const existing = prev.filter((n) => watchedItems.includes(n))
      const newNames = watchedItems.filter((n) => !existing.includes(n))
      const merged = [...existing, ...newNames]
      if (merged.length === prev.length && merged.every((n, i) => n === prev[i])) return prev
      return merged
    })
  }, [watchedItems])

  // 並び順が変わったら DB に保存
  useEffect(() => {
    if (itemOrder.length > 0) void window.api.saveWatchedItemOrder(itemOrder)
  }, [itemOrder])

  // itemOrder に従って並び替えたバッジ一覧
  const orderedWatchedItems = useMemo(() => {
    if (!watchedItems) return null
    const orderMap = new Map(itemOrder.map((name, i) => [name, i]))
    return [...watchedItems].sort(
      (a, b) => (orderMap.get(a) ?? Infinity) - (orderMap.get(b) ?? Infinity)
    )
  }, [watchedItems, itemOrder])

  function handleItemDrop(targetName: string, position: 'before' | 'after', fromName: string): void {
    if (!fromName || fromName === targetName) return
    setItemOrder((prev) => {
      const newOrder = [...prev]
      const fromIdx = newOrder.indexOf(fromName)
      const toIdx = newOrder.indexOf(targetName)
      if (fromIdx === -1 || toIdx === -1) return prev
      newOrder.splice(fromIdx, 1)
      let insertAt = newOrder.indexOf(targetName)
      if (position === 'after') insertAt++
      newOrder.splice(insertAt, 0, fromName)
      return newOrder
    })
    setDropIndicator(null)
  }

  const allDates = useMemo(() => {
    if (!activeRecords) return []
    return [...new Set(activeRecords.map((r) => r.date))].sort()
  }, [activeRecords])

  // 集計対象（全キャラ合計⇔特定キャラクター）を切り替えたら、期間を選び直せるようリセットする。
  useEffect(() => {
    setRangeStart('')
    setRangeEnd('')
  }, [selectedCharacter])

  // 記録が読み込まれたら、初回のみ期間を全期間で初期化する。
  useEffect(() => {
    if (allDates.length === 0) return
    setRangeStart((prev) => prev || allDates[0])
    setRangeEnd((prev) => prev || allDates[allDates.length - 1])
  }, [allDates])

  // アイテムごとの記録履歴（日付昇順）。前日比較・期間比較の両方で使う。
  const historyByItem = useMemo(() => {
    const map = new Map<string, DailyTrackedItemRecord[]>()
    if (!activeRecords) return map
    for (const r of activeRecords) {
      const list = map.get(r.itemName) ?? []
      list.push(r)
      map.set(r.itemName, list)
    }
    for (const list of map.values()) list.sort((a, b) => a.date.localeCompare(b.date))
    return map
  }, [activeRecords])

  // 選択期間内の日付一覧（列見出し用、昇順）。
  const rangeDates = useMemo(() => {
    if (!rangeStart || !rangeEnd) return []
    return allDates.filter((d) => d >= rangeStart && d <= rangeEnd)
  }, [allDates, rangeStart, rangeEnd])

  // アイテム × 日付の行列。セルにはその日の所持数と、前日（直前記録）との差分を持たせる。
  const pivotRows = useMemo(() => {
    if (rangeDates.length === 0) return null
    const itemNames = orderItemNames([...historyByItem.keys()], itemOrder)
    return itemNames
      .map((name) => {
        const history = historyByItem.get(name)!
        const byDate = new Map(history.map((r) => [r.date, r]))
        const cells = rangeDates.map((date) => {
          const cur = byDate.get(date)
          if (!cur) return null
          const idx = history.indexOf(cur)
          const prev = history[idx - 1]
          return { count: cur.count, diff: prev ? cur.count - prev.count : null }
        })
        return { name, cells }
      })
      .filter((row) => row.cells.some((c) => c !== null))
  }, [historyByItem, rangeDates, itemOrder])

  // グラフ用の設定（アイテム名ごとにラベルと色を割り当てる）。行と同じアイテム集合を使う。
  const chartConfig = useMemo<ChartConfig>(() => {
    const config: ChartConfig = {}
    pivotRows?.forEach((row, i) => {
      config[row.name] = { label: row.name, color: CHART_PALETTE[i % CHART_PALETTE.length] }
    })
    return config
  }, [pivotRows])

  // グラフ用のデータ行。日付ごとに各アイテムの所持数（差分ではなく実数）を持つ。
  const chartRows = useMemo(() => {
    if (!pivotRows || rangeDates.length === 0) return null
    return rangeDates.map((date) => {
      const row: Record<string, string | number | null> = { date: formatDateHeader(date) }
      for (const item of pivotRows) {
        const rec = historyByItem.get(item.name)?.find((r) => r.date === date)
        row[item.name] = rec ? rec.count : null
      }
      return row
    })
  }, [pivotRows, historyByItem, rangeDates])

  // 開始日と終了日それぞれ「以前で最新」の記録同士を比較する（両端がぴったり記録日でなくてもよい）。
  const summary = useMemo(() => {
    if (!rangeStart || !rangeEnd) return null
    const itemNames = orderItemNames([...historyByItem.keys()], itemOrder)
    return itemNames
      .map((name) => {
        const history = historyByItem.get(name)!
        const start = latestOnOrBefore(history, rangeStart)
        const end = latestOnOrBefore(history, rangeEnd)
        if (!start && !end) return null
        const diff = start && end ? end.count - start.count : null
        return { name, start, end, diff }
      })
      .filter((v): v is NonNullable<typeof v> => v !== null)
  }, [historyByItem, rangeStart, rangeEnd, itemOrder])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b px-6 py-3">
        <h2 className="mr-2 text-base font-semibold">履歴</h2>
        <Badge variant="outline">AM6:00 更新</Badge>
        {pivotRows && <Badge variant="secondary">{pivotRows.length} 種</Badge>}
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <TabChip
            label="合計"
            active={selectedCharacter === ''}
            onClick={() => setSelectedCharacter('')}
          />
          {characterNames.map((name) => (
            <TabChip
              key={name}
              label={name}
              prefix={characterPrefixes?.get(name)}
              active={selectedCharacter === name}
              onClick={() => setSelectedCharacter(name)}
            />
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b px-6 py-2">
        <Input
          className="w-56"
          placeholder="監視するアイテム名を入力…"
          value={newItemName}
          onChange={(e) => setNewItemName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void handleAddItem()
          }}
        />
        <Button size="sm" onClick={() => void handleAddItem()} disabled={!newItemName.trim()}>
          <Plus className="size-4" />
          追加
        </Button>
        <div className="flex flex-wrap items-center gap-1.5">
          {orderedWatchedItems?.map((name) => {
            const dropPos = dropIndicator?.name === name ? dropIndicator.position : null
            return (
              <span key={name} className="relative">
                {dropPos === 'before' && (
                  <span className="absolute -left-1 top-0.5 bottom-0.5 z-10 w-0.5 rounded-full bg-primary" />
                )}
                <Badge
                  variant="secondary"
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.effectAllowed = 'move'
                    e.dataTransfer.setData('text/plain', name)
                  }}
                  onDragOver={(e) => {
                    e.preventDefault()
                    e.dataTransfer.dropEffect = 'move'
                    const rect = e.currentTarget.getBoundingClientRect()
                    const position = e.clientX - rect.left < rect.width / 2 ? 'before' : 'after'
                    setDropIndicator({ name, position })
                  }}
                  onDragLeave={(e) => {
                    if (e.currentTarget.contains(e.relatedTarget as Node)) return
                    setDropIndicator(null)
                  }}
                  onDrop={(e) => {
                    e.preventDefault()
                    const fromName = e.dataTransfer.getData('text/plain')
                    const position = dropIndicator?.position ?? 'before'
                    handleItemDrop(name, position, fromName)
                  }}
                  onDragEnd={() => setDropIndicator(null)}
                  className="cursor-grab gap-1 pl-1 active:cursor-grabbing"
                >
                  <button
                    onClick={() => void handleRemoveItem(name)}
                    aria-label={`${name} を監視対象から削除`}
                    className="hover:bg-muted-foreground/20 rounded-full p-0.5"
                  >
                    <X className="size-3" />
                  </button>
                  {name}
                </Badge>
                {dropPos === 'after' && (
                  <span className="absolute -right-1 top-0.5 bottom-0.5 z-10 w-0.5 rounded-full bg-primary" />
                )}
              </span>
            )
          })}
          {orderedWatchedItems && orderedWatchedItems.length === 0 && (
            <span className="text-muted-foreground text-xs">監視中のアイテムはありません</span>
          )}
        </div>
      </div>

      {activeRecords && activeRecords.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b px-6 py-2">
          <span className="text-muted-foreground text-sm">開始日</span>
          <DatePicker
            value={rangeStart}
            onChange={setRangeStart}
            min={allDates[0]}
            max={rangeEnd || allDates[allDates.length - 1]}
          />
          <span className="text-muted-foreground">〜</span>
          <span className="text-muted-foreground text-sm">終了日</span>
          <DatePicker
            value={rangeEnd}
            onChange={setRangeEnd}
            min={rangeStart || allDates[0]}
            max={allDates[allDates.length - 1]}
          />
        </div>
      )}

      {activeRecords && activeRecords.length > 0 && (
        <div className="flex flex-wrap gap-1.5 border-b px-6 py-2">
          <TabChip label="日次比較" active={tab === 'daily'} onClick={() => setTab('daily')} />
          <TabChip label="期間比較" active={tab === 'period'} onClick={() => setTab('period')} />
          <TabChip label="グラフ" active={tab === 'chart'} onClick={() => setTab('chart')} />
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-hidden px-6 py-4">
        {!pivotRows ? (
          <div className="text-muted-foreground py-8 text-center">読み込み中…</div>
        ) : pivotRows.length === 0 ? (
          <div className="text-muted-foreground py-8 text-center">
            選択した期間に記録がありません。上でアイテム名を登録すると、AM6:00以降に自動で記録されます。
          </div>
        ) : tab === 'daily' ? (
          <Table containerClassName="h-full overflow-auto">
            <TableHeader className="sticky top-0 z-10 bg-background">
              <TableRow>
                <TableHead className="sticky left-0 z-20 min-w-40 bg-background">
                  アイテム名
                </TableHead>
                {rangeDates.map((date) => (
                  <TableHead key={date} className="w-[100px] text-right">
                    {formatDateHeader(date)}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {pivotRows.map((row) => (
                <TableRow key={row.name}>
                  <TableCell className="sticky left-0 z-10 bg-background font-medium">
                    {row.name}
                  </TableCell>
                  {row.cells.map((cell, i) => (
                    <TableCell key={rangeDates[i]} className="text-right">
                      {cell && (
                        <div className="flex flex-col leading-tight">
                          <span className={diffClass(cell.diff)}>{formatDiff(cell.diff)}</span>
                          <span className="text-muted-foreground font-mono text-xs tabular-nums">
                            {cell.count.toLocaleString()}
                          </span>
                        </div>
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : tab === 'chart' ? (
          chartRows && (
            <div className="flex h-full min-h-0 flex-col">
              <div className="mb-2 flex shrink-0 flex-wrap items-center gap-1.5">
                <button
                  onClick={() =>
                    setHiddenSeries((prev) =>
                      prev.size > 0 ? new Set() : new Set(pivotRows?.map((row) => row.name))
                    )
                  }
                  className="rounded-full border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent"
                >
                  {hiddenSeries.size > 0 ? 'すべて表示' : 'すべて非表示'}
                </button>
                {pivotRows?.map((row) => {
                  const hidden = hiddenSeries.has(row.name)
                  const color = chartConfig[row.name]?.color as string | undefined
                  return (
                    <button
                      key={row.name}
                      onClick={() => toggleSeries(row.name)}
                      aria-pressed={!hidden}
                      className={cn(
                        'flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors',
                        hidden ? 'text-muted-foreground opacity-50 hover:bg-accent' : 'hover:bg-accent'
                      )}
                    >
                      <span
                        className="size-2 shrink-0 rounded-full"
                        style={{ backgroundColor: color }}
                      />
                      {row.name}
                    </button>
                  )
                })}
              </div>
              <ChartContainer config={chartConfig} className="min-h-0 flex-1 w-full">
                <LineChart data={chartRows} margin={{ left: 12, right: 12, top: 12 }}>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="date" tickLine={false} axisLine={false} />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    width={64}
                    tickFormatter={(v: number) => v.toLocaleString()}
                  />
                  <ChartTooltip content={<ChartTooltipContent indicator="dot" />} />
                  {pivotRows?.map((row) => (
                    <Line
                      key={row.name}
                      type="monotone"
                      dataKey={row.name}
                      stroke={`var(--color-${row.name})`}
                      strokeWidth={2}
                      dot={false}
                      connectNulls
                      hide={hiddenSeries.has(row.name)}
                    />
                  ))}
                </LineChart>
              </ChartContainer>
            </div>
          )
        ) : (
          summary &&
          (summary.length === 0 ? (
            <div className="text-muted-foreground py-8 text-center">
              選択した期間に比較できる記録がありません。
            </div>
          ) : (
            <div className="flex h-full min-h-0 flex-col">
              <h3 className="mb-2 flex shrink-0 items-center gap-2 text-sm font-semibold">
                期間比較（{rangeStart} → {rangeEnd}）
              </h3>
              <Table
                className="table-fixed"
                containerClassName="min-h-0 flex-1 overflow-auto"
              >
                <TableHeader className="sticky top-0 z-10 bg-background">
                  <TableRow>
                    <TableHead className="w-auto">アイテム名</TableHead>
                    <TableHead className="w-[140px] text-right">開始日所持数</TableHead>
                    <TableHead className="w-[140px] text-right">終了日所持数</TableHead>
                    <TableHead className="w-[140px] text-right">増減</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {summary.map((s) => (
                    <TableRow key={s.name}>
                      <TableCell className="truncate font-medium">{s.name}</TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {s.start ? s.start.count.toLocaleString() : '—'}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {s.end ? s.end.count.toLocaleString() : '—'}
                      </TableCell>
                      <TableCell className={cn('text-right', diffClass(s.diff))}>
                        {formatDiff(s.diff)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

function TabChip({
  label,
  prefix,
  active,
  onClick
}: {
  label: string
  // キャラクター名チップの場合、D/B のアイコンバッジ（App.tsx のキャラ一覧と同じ配色）。
  prefix?: string
  active: boolean
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors',
        active ? 'bg-primary text-primary-foreground border-transparent' : 'hover:bg-accent'
      )}
    >
      {prefix && (
        <span
          className={cn(
            'inline-flex size-4 shrink-0 items-center justify-center rounded text-[10px] font-bold text-white',
            prefix === 'D' && 'bg-red-500',
            prefix === 'B' && 'bg-emerald-500'
          )}
        >
          {prefix}
        </span>
      )}
      {label}
    </button>
  )
}
