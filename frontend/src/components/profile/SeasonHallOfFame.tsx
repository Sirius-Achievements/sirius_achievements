import type { SeasonResult } from '@/types/user'

type SeasonHallOfFameProps = {
  items: SeasonResult[]
  className?: string
}

const PODIUM_META: Record<number, { label: string; color: string; soft: string }> = {
  1: { label: 'Золото сезона', color: '#d7a81e', soft: '#fff4c2' },
  2: { label: 'Серебро сезона', color: '#8b98a7', soft: '#edf1f5' },
  3: { label: 'Бронза сезона', color: '#b86f3f', soft: '#f7dfcf' },
}

function bestPodiumStreak(items: SeasonResult[]) {
  const chronological = [...items].sort((left, right) => {
    const dateDiff = new Date(left.created_at).getTime() - new Date(right.created_at).getTime()
    return dateDiff || left.id - right.id
  })
  let current = 0
  let best = 0
  for (const item of chronological) {
    if (item.rank >= 1 && item.rank <= 3) {
      current += 1
      best = Math.max(best, current)
    } else {
      current = 0
    }
  }
  return best
}

function Medal({ rank }: { rank: number }) {
  const meta = PODIUM_META[rank]
  if (!meta) {
    return (
      <span
        className="inline-flex h-10 min-w-10 items-center justify-center rounded-full border px-2 text-xs font-black"
        style={{ borderColor: 'var(--color-accent)', color: 'var(--color-accent-strong)', background: 'var(--color-accent-soft)' }}
      >
        #{rank}
      </span>
    )
  }

  return (
    <span className="relative inline-flex h-12 w-10 shrink-0 items-end justify-center" title={meta.label} aria-label={meta.label}>
      <span className="absolute left-1 top-0 h-7 w-3 -rotate-6 rounded-sm" style={{ background: 'var(--color-accent)' }} />
      <span className="absolute right-1 top-0 h-7 w-3 rotate-6 rounded-sm opacity-70" style={{ background: 'var(--color-accent-strong)' }} />
      <span
        className="relative z-10 inline-flex h-9 w-9 items-center justify-center rounded-full border-2 text-sm font-black shadow-sm"
        style={{ borderColor: meta.color, background: meta.soft, color: meta.color }}
      >
        {rank}
      </span>
    </span>
  )
}

function streakTitle(streak: number) {
  if (streak >= 4) return 'Легендарная серия'
  if (streak === 3) return 'Золотая серия'
  return 'Серия призовых мест'
}

export function SeasonHallOfFame({ items, className = '' }: SeasonHallOfFameProps) {
  if (!items.length) return null

  const orderedItems = [...items].sort((left, right) => {
    const dateDiff = new Date(right.created_at).getTime() - new Date(left.created_at).getTime()
    return dateDiff || right.id - left.id
  })
  const streak = bestPodiumStreak(items)
  const podiums = items.filter((item) => item.rank >= 1 && item.rank <= 3).length

  return (
    <section
      className={`overflow-hidden rounded-2xl border bg-surface shadow-sm ${className}`}
      style={{ borderColor: 'var(--color-accent)' }}
    >
      <div className="flex flex-col gap-3 border-b px-5 py-4 sm:flex-row sm:items-center sm:justify-between" style={{ borderColor: 'var(--color-accent-soft-strong)' }}>
        <div>
          <h3 className="text-sm font-bold text-slate-800">Зал славы</h3>
          <p className="mt-0.5 text-xs text-slate-500">Архив сезонов, набранные баллы и награды за призовые места</p>
        </div>
        <div className="flex flex-wrap gap-2 text-[11px] font-semibold">
          <span className="rounded-full px-3 py-1" style={{ background: 'var(--color-accent-soft)', color: 'var(--color-accent-strong)' }}>
            {items.length} сез.
          </span>
          {podiums > 0 ? (
            <span className="rounded-full px-3 py-1" style={{ background: 'var(--color-accent-soft)', color: 'var(--color-accent-strong)' }}>
              {podiums} призовых
            </span>
          ) : null}
        </div>
      </div>

      {streak >= 2 ? (
        <div className="mx-5 mt-4 flex items-center gap-3 rounded-xl border p-3" style={{ borderColor: 'var(--color-accent)', background: 'var(--color-accent-soft)' }}>
          <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xl" style={{ background: 'var(--color-accent)', color: '#fff' }}>★</span>
          <div>
            <div className="text-xs font-bold" style={{ color: 'var(--color-accent-strong)' }}>{streakTitle(streak)}</div>
            <div className="mt-0.5 text-[11px] text-slate-600">{streak} сезона подряд на призовом месте</div>
          </div>
        </div>
      ) : null}

      <div className="grid gap-3 p-5 sm:grid-cols-2 xl:grid-cols-3">
        {orderedItems.map((item) => {
          const podium = PODIUM_META[item.rank]
          return (
            <article
              key={item.id}
              className="flex min-w-0 items-center gap-3 rounded-xl border p-3 transition-transform hover:-translate-y-0.5"
              style={{ borderColor: 'var(--color-accent-soft-strong)', background: 'var(--color-surface-soft)' }}
            >
              <Medal rank={item.rank} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-bold text-slate-800">{item.season_name}</div>
                <div className="mt-1 text-[11px] text-slate-500">
                  Место <strong style={{ color: 'var(--color-accent-strong)' }}>#{item.rank}</strong>
                  {podium ? <span className="ml-1.5">· {podium.label}</span> : null}
                </div>
              </div>
              <div className="shrink-0 text-right">
                <div className="text-lg font-black" style={{ color: 'var(--color-accent-strong)' }}>{item.points}</div>
                <div className="text-[10px] text-slate-400">баллов</div>
              </div>
            </article>
          )
        })}
      </div>
    </section>
  )
}
