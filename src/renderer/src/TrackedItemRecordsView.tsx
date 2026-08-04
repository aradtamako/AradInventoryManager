import { useEffect, useMemo, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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
import type { DailyTrackedItemRecord } from '@shared/types'

function diffClass(diff: number | null): string {
  return cn(
    'text-right font-mono tabular-nums',
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
type Tab = 'daily' | 'period'

export function TrackedItemRecordsView(): React.JSX.Element {
  const [records, setRecords] = useState<DailyTrackedItemRecord[] | null>(null)
  const [watchedItems, setWatchedItems] = useState<string[] | null>(null)
  const [newItemName, setNewItemName] = useState('')
  const [rangeStart, setRangeStart] = useState('')
  const [rangeEnd, setRangeEnd] = useState('')
  const [tab, setTab] = useState<Tab>('daily')

  useEffect(() => {
    void window.api.getTrackedItemRecords().then(setRecords)
    void window.api.listWatchedItems().then(setWatchedItems)
  }, [])

  async function handleAddItem(): Promise<void> {
    const name = newItemName.trim()
    if (!name) return
    setNewItemName('')
    setWatchedItems(await window.api.addWatchedItem(name))
  }

  async function handleRemoveItem(name: string): Promise<void> {
    setWatchedItems(await window.api.removeWatchedItem(name))
  }

  const allDates = useMemo(() => {
    if (!records) return []
    return [...new Set(records.map((r) => r.date))].sort()
  }, [records])

  // 記録が読み込まれたら、初回のみ期間を全期間で初期化する。
  useEffect(() => {
    if (allDates.length === 0) return
    setRangeStart((prev) => prev || allDates[0])
    setRangeEnd((prev) => prev || allDates[allDates.length - 1])
  }, [allDates])

  // アイテムごとの記録履歴（日付昇順）。前日比較・期間比較の両方で使う。
  const historyByItem = useMemo(() => {
    const map = new Map<string, DailyTrackedItemRecord[]>()
    if (!records) return map
    for (const r of records) {
      const list = map.get(r.itemName) ?? []
      list.push(r)
      map.set(r.itemName, list)
    }
    for (const list of map.values()) list.sort((a, b) => a.date.localeCompare(b.date))
    return map
  }, [records])

  // 選択期間内の日付一覧（列見出し用、昇順）。
  const rangeDates = useMemo(() => {
    if (!rangeStart || !rangeEnd) return []
    return allDates.filter((d) => d >= rangeStart && d <= rangeEnd)
  }, [allDates, rangeStart, rangeEnd])

  // アイテム × 日付の行列。セルの値はその日の前日（直前記録）との差分。
  const pivotRows = useMemo(() => {
    if (rangeDates.length === 0) return null
    const itemNames = [...historyByItem.keys()].sort((a, b) => a.localeCompare(b, 'ja'))
    return itemNames
      .map((name) => {
        const history = historyByItem.get(name)!
        const byDate = new Map(history.map((r) => [r.date, r]))
        const cells = rangeDates.map((date) => {
          const cur = byDate.get(date)
          if (!cur) return null
          const idx = history.indexOf(cur)
          const prev = history[idx - 1]
          return prev ? cur.count - prev.count : null
        })
        return { name, cells }
      })
      .filter((row) => row.cells.some((c) => c !== null))
  }, [historyByItem, rangeDates])

  // 開始日と終了日それぞれ「以前で最新」の記録同士を比較する（両端がぴったり記録日でなくてもよい）。
  const summary = useMemo(() => {
    if (!rangeStart || !rangeEnd) return null
    const itemNames = [...historyByItem.keys()].sort((a, b) => a.localeCompare(b, 'ja'))
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
  }, [historyByItem, rangeStart, rangeEnd])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b px-6 py-3">
        <h2 className="mr-2 text-base font-semibold">アイテム監視記録</h2>
        <Badge variant="outline">AM6:00 更新</Badge>
        {pivotRows && <Badge variant="secondary">{pivotRows.length} 種</Badge>}
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
          {watchedItems?.map((name) => (
            <Badge key={name} variant="secondary" className="gap-1 pr-1">
              {name}
              <button
                onClick={() => void handleRemoveItem(name)}
                aria-label={`${name} を監視対象から削除`}
                className="hover:bg-muted-foreground/20 rounded-full p-0.5"
              >
                <X className="size-3" />
              </button>
            </Badge>
          ))}
          {watchedItems && watchedItems.length === 0 && (
            <span className="text-muted-foreground text-xs">監視中のアイテムはありません</span>
          )}
        </div>
      </div>

      {records && records.length > 0 && (
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

      {records && records.length > 0 && (
        <div className="flex flex-wrap gap-1.5 border-b px-6 py-2">
          <TabChip label="日次比較" active={tab === 'daily'} onClick={() => setTab('daily')} />
          <TabChip label="期間比較" active={tab === 'period'} onClick={() => setTab('period')} />
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
        {!pivotRows ? (
          <div className="text-muted-foreground py-8 text-center">読み込み中…</div>
        ) : pivotRows.length === 0 ? (
          <div className="text-muted-foreground py-8 text-center">
            選択した期間に記録がありません。上でアイテム名を登録すると、AM6:00以降に自動で記録されます。
          </div>
        ) : tab === 'daily' ? (
          <Table containerClassName="max-h-[calc(100vh-320px)] overflow-auto">
            <TableHeader className="sticky top-0 z-10 bg-background">
              <TableRow>
                <TableHead className="sticky left-0 z-20 min-w-40 bg-background">
                  アイテム名
                </TableHead>
                {rangeDates.map((date) => (
                  <TableHead key={date} className="w-[90px] text-right">
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
                  {row.cells.map((diff, i) => (
                    <TableCell key={rangeDates[i]} className={diffClass(diff)}>
                      {formatDiff(diff)}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          summary &&
          (summary.length === 0 ? (
            <div className="text-muted-foreground py-8 text-center">
              選択した期間に比較できる記録がありません。
            </div>
          ) : (
            <div>
              <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
                期間比較（{rangeStart} → {rangeEnd}）
              </h3>
              <Table className="table-fixed">
                <TableHeader>
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
                      <TableCell className={diffClass(s.diff)}>{formatDiff(s.diff)}</TableCell>
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
