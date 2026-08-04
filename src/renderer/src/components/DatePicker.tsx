import { useState } from 'react'
import { ChevronDownIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

// value/min/max は "YYYY-MM-DD" 形式（DailyTrackedItemRecord の date と同じ）。
function parseDate(value: string): Date | undefined {
  if (!value) return undefined
  const [y, m, d] = value.split('-').map(Number)
  return new Date(y, m - 1, d)
}

function toDateString(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

// shadcn/ui の Date Picker（"Date of Birth" パターン）を、YYYY-MM-DD 文字列で
// 値をやり取りする形にラップしたもの。ネイティブ date input の代わりに使う。
export function DatePicker({
  value,
  onChange,
  min,
  max,
  placeholder = '日付を選択'
}: {
  value: string
  onChange: (value: string) => void
  min?: string
  max?: string
  placeholder?: string
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const selected = parseDate(value)
  const minDate = min ? parseDate(min) : undefined
  const maxDate = max ? parseDate(max) : undefined

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className="w-[140px] justify-between font-normal"
          type="button"
        >
          {selected ? selected.toLocaleDateString('ja-JP') : placeholder}
          <ChevronDownIcon className="size-4 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto overflow-hidden p-0" align="start">
        <Calendar
          mode="single"
          selected={selected}
          captionLayout="dropdown"
          disabled={(date) => (minDate ? date < minDate : false) || (maxDate ? date > maxDate : false)}
          onSelect={(date) => {
            if (date) onChange(toDateString(date))
            setOpen(false)
          }}
        />
      </PopoverContent>
    </Popover>
  )
}
