import { useState } from 'react'

import { cn } from '@/utils/cn'

export interface SearchSuggestionItem {
  id?: number
  value: string
  text: string
}

interface SearchAutocompleteInputProps {
  label?: string
  value: string
  placeholder: string
  suggestions: SearchSuggestionItem[]
  onChange: (value: string) => void
  onSelectSuggestion: (item: SearchSuggestionItem) => void
  className?: string
}

function restoreMojibake(value: string) {
  if (!value) {
    return value
  }

  if (!looksBrokenText(value)) {
    return value
  }

  const utf8Decoder = new TextDecoder('utf-8')

  const suspiciousScore = (text: string) => {
    const latinMojibake = (text.match(/[ÃÂÐÑ]/g) ?? []).length
    const cyrillicMojibake = (text.match(/[РС][\u0400-\u04ff]/g) ?? []).length
    const boxChars = (text.match(/[\u2500-\u257f]/g) ?? []).length
    const replacementChars = (text.match(/\uFFFD/g) ?? []).length
    const cyrillicChars = (text.match(/[\u0400-\u04ff]/g) ?? []).length

    return cyrillicChars * 2 - latinMojibake * 3 - cyrillicMojibake * 4 - boxChars * 5 - replacementChars * 6
  }

  const decodeSingleByte = (text: string, toByte: (char: string) => number | null) => {
    const bytes: number[] = []

    for (const char of text) {
      const byte = toByte(char)
      if (byte === null) {
        return text
      }

      bytes.push(byte)
    }

    try {
      return utf8Decoder.decode(Uint8Array.from(bytes))
    } catch {
      return text
    }
  }

  const decodeLatin1Like = (text: string) =>
    decodeSingleByte(text, (char) => {
      const code = char.charCodeAt(0)
      return code <= 0xff ? code : null
    })

  const decodeCp1251Like = (text: string) =>
    decodeSingleByte(text, (char) => {
      const code = char.charCodeAt(0)

      if (code <= 0x7f) return code
      if (code === 0x0401) return 0xa8
      if (code === 0x0451) return 0xb8
      if (code === 0x2116) return 0xb9
      if (code >= 0x0410 && code <= 0x044f) return code - 0x350

      return null
    })

  let current = value

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const latin1Candidate = decodeLatin1Like(current)
    const cp1251Candidate = decodeCp1251Like(current)
    const candidates = [latin1Candidate, cp1251Candidate].filter((candidate) => candidate !== current)

    if (!candidates.length) {
      break
    }

    const bestCandidate = candidates.reduce((best, candidate) =>
      suspiciousScore(candidate) > suspiciousScore(best) ? candidate : best,
    current)

    if (bestCandidate === current || suspiciousScore(bestCandidate) <= suspiciousScore(current)) {
      break
    }

    current = bestCandidate
  }

  return current
}

function looksBrokenText(value: string) {
  return /[ÃÂÐÑ]/.test(value) || /[�]/.test(value) || /(?:[РС][\u0400-\u04ff]){2,}/.test(value)
}

export function SearchAutocompleteInput({
  label = '\u041f\u043e\u0438\u0441\u043a',
  value,
  placeholder,
  suggestions,
  onChange,
  onSelectSuggestion,
  className,
}: SearchAutocompleteInputProps) {
  const [isFocused, setIsFocused] = useState(false)
  const showSuggestions = isFocused && suggestions.length > 0
  const repairedLabel = restoreMojibake(label)
  const repairedPlaceholder = restoreMojibake(placeholder)
  const resolvedLabel = looksBrokenText(repairedLabel) ? '\u041f\u043e\u0438\u0441\u043a' : repairedLabel
  const resolvedPlaceholder = looksBrokenText(repairedPlaceholder)
    ? '\u0412\u0432\u0435\u0434\u0438\u0442\u0435 \u0437\u0430\u043f\u0440\u043e\u0441...'
    : repairedPlaceholder

  return (
    <div className={cn('relative', className)}>
      <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-slate-500">
        {resolvedLabel}
      </label>
      <div className="relative">
        <div className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-slate-400">
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
        </div>
        <input
          type="text"
          value={value}
          placeholder={resolvedPlaceholder}
          autoComplete="off"
          onFocus={() => setIsFocused(true)}
          onBlur={() => window.setTimeout(() => setIsFocused(false), 120)}
          onChange={(event) => {
            setIsFocused(true)
            onChange(event.target.value)
          }}
          className="h-[38px] w-full rounded-lg border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-sm text-slate-800 outline-none transition-all focus:border-indigo-600 focus:bg-surface focus:ring-2 focus:ring-indigo-600/20"
        />
      </div>

      {showSuggestions ? (
        <ul className="absolute left-0 right-0 z-50 mt-1 max-h-60 overflow-y-auto rounded-xl border border-slate-200 bg-surface shadow-lg">
          {suggestions.map((item) => (
            <li
              key={item.id ? `${item.id}` : `${item.value}-${item.text}`}
              onMouseDown={(event) => {
                event.preventDefault()
                onSelectSuggestion(item)
                setIsFocused(false)
              }}
              className="cursor-pointer border-b border-slate-100 px-4 py-2 text-sm text-slate-700 transition-colors hover:bg-slate-50 last:border-b-0"
            >
              {(() => {
                const repairedItemText = restoreMojibake(item.text)
                return looksBrokenText(repairedItemText) ? item.value : repairedItemText
              })()}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
