// Reusable combinable filter: a labelled group of toggleable chips.
// Multi-select within one group means OR; different groups combine with AND
// (each group is an independent filter dimension).

export function ChipToggle({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-[11px] font-medium transition-colors ${active ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-slate-200 bg-slate-50 text-slate-600 hover:border-indigo-300'}`}
    >
      {active ? (
        <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" />
        </svg>
      ) : null}
      {label}
    </button>
  )
}

interface ChipMultiSelectProps {
  label: string
  options: string[]
  selected: string[]
  onToggle: (value: string) => void
  labelFor?: (value: string) => string
  onReset?: () => void
  // Optional OR/AND toggle, shown only when 2+ values are selected.
  // OR = matches any of the selected; AND = owner has all of the selected.
  logic?: 'or' | 'and'
  onLogicChange?: (logic: 'or' | 'and') => void
  andHint?: string
}

export function ChipMultiSelect({
  label,
  options,
  selected,
  onToggle,
  labelFor,
  onReset,
  logic,
  onLogicChange,
  andHint,
}: ChipMultiSelectProps) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500">
          {label} {selected.length > 0 ? `(${selected.length})` : '— все'}
        </label>
        {selected.length > 0 && onReset ? (
          <button type="button" onClick={onReset} className="text-[11px] font-semibold text-slate-500 hover:underline">
            Сбросить
          </button>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => (
          <ChipToggle key={o} active={selected.includes(o)} label={labelFor ? labelFor(o) : o} onClick={() => onToggle(o)} />
        ))}
      </div>
      {logic && onLogicChange && selected.length > 1 ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-semibold text-slate-500">Логика:</span>
          <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-[11px] font-semibold">
            <button
              type="button"
              onClick={() => onLogicChange('or')}
              className={`px-3 py-1 rounded-md transition-colors ${logic === 'or' ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:text-slate-700'}`}
            >
              Любое из
            </button>
            <button
              type="button"
              onClick={() => onLogicChange('and')}
              className={`px-3 py-1 rounded-md transition-colors ${logic === 'and' ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:text-slate-700'}`}
            >
              Все сразу
            </button>
          </div>
          <span className="text-[11px] text-slate-400">
            {logic === 'and' ? andHint ?? 'у владельца есть все выбранные' : 'подходит любое из выбранных'}
          </span>
        </div>
      ) : null}
    </div>
  )
}
