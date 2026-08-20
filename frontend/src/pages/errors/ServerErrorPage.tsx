import { Link } from 'react-router-dom'

export function ServerErrorPage() {
  const errorId = `ERR-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`
  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center text-center px-4">
      <div className="bg-surface p-8 md:p-10 rounded-2xl shadow-sm border border-slate-200 max-w-md w-full flex flex-col items-center">
        <div className="w-16 h-16 bg-amber-50 rounded-full flex items-center justify-center mb-5">
          <svg className="w-8 h-8 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>
        <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight mb-2">500</h1>
        <h2 className="text-lg font-bold text-slate-800 mb-2">Ошибка сервера</h2>
        <p className="text-sm text-slate-500 mb-3 leading-relaxed">Что-то пошло не так. Повторите запрос; если ошибка останется, отправьте готовый технический отчёт.</p>
        <code className="mb-5 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">{errorId}</code>
        <button type="button" onClick={() => window.location.reload()} className="mb-2 w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-indigo-700">Повторить</button>
        <button type="button" onClick={() => window.dispatchEvent(new CustomEvent('open-bug-report', { detail: { description: `Ошибка 500. Технический ID: ${errorId}` } }))} className="mb-2 w-full rounded-lg border border-indigo-200 px-4 py-2.5 text-sm font-medium text-indigo-600 hover:bg-indigo-50">Отправить баг-репорт</button>
        <button type="button" onClick={() => window.history.back()} className="mb-2 w-full rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50">Вернуться назад</button>
        <Link to="/support" className="w-full inline-flex items-center justify-center px-4 py-2.5 text-sm font-medium rounded-lg text-slate-600 border border-slate-200 hover:bg-slate-50 transition-colors">
          <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /></svg>
          Открыть поддержку
        </Link>
      </div>
    </div>
  )
}
