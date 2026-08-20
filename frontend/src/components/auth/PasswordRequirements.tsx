import { getPasswordRequirements } from '@/utils/password'

interface PasswordRequirementsProps {
  password: string
}
export function PasswordRequirements({ password }: PasswordRequirementsProps) {
  const requirements = getPasswordRequirements(password)
  const completed = requirements.filter((requirement) => requirement.met).length
  const percent = (completed / requirements.length) * 100

  return (
    <div className="mt-2" aria-live="polite">
      <div className="mb-3 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
        <div
          className="h-full bg-indigo-600 transition-all duration-300 ease-out"
          style={{ width: `${percent}%`, opacity: 0.45 + completed * 0.11 }}
        />
      </div>
      <p className="sr-only">Выполнено требований к паролю: {completed} из {requirements.length}</p>
      <ul className="grid grid-cols-1 gap-x-3 gap-y-1 text-[11px] text-slate-500 sm:grid-cols-2">
        {requirements.map((requirement) => (
          <li
            key={requirement.id}
            className={`flex items-center ${requirement.met ? 'font-medium text-indigo-600' : ''}`}
          >
            {requirement.met ? (
              <svg className="mr-1 h-3 w-3 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
              </svg>
            ) : (
              <span className="mr-1.5 opacity-50" aria-hidden="true">•</span>
            )}
            {requirement.label}
          </li>
        ))}
      </ul>
    </div>
  )
}
