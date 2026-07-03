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
}

export function ChipMultiSelect({ label, options, selected, onToggle, labelFor, onReset }: ChipMultiSelectProps) {
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
    </div>
  )
}
