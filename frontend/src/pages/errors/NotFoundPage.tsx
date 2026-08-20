import { Link } from 'react-router-dom'

export function NotFoundPage() {
  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center text-center px-4">
      <div className="bg-surface p-8 md:p-10 rounded-2xl shadow-sm border border-slate-200 max-w-md w-full flex flex-col items-center">
        <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mb-5">
          <svg className="w-8 h-8 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight mb-2">404</h1>
        <h2 className="text-lg font-bold text-slate-800 mb-2">Страница не найдена</h2>
        <p className="text-sm text-slate-500 mb-5 leading-relaxed">Похоже, вы перешли по неверной ссылке или страница была удалена. Выберите нужный раздел.</p>
        <div className="mb-3 grid w-full grid-cols-2 gap-2 text-sm">
          <Link to="/documents" className="rounded-lg border border-slate-200 px-3 py-2 text-slate-600 hover:bg-slate-50">Документы</Link>
          <Link to="/leaderboard" className="rounded-lg border border-slate-200 px-3 py-2 text-slate-600 hover:bg-slate-50">Рейтинг</Link>
          <Link to="/profile" className="rounded-lg border border-slate-200 px-3 py-2 text-slate-600 hover:bg-slate-50">Профиль</Link>
          <Link to="/support" className="rounded-lg border border-slate-200 px-3 py-2 text-slate-600 hover:bg-slate-50">Поддержка</Link>
        </div>
        <button type="button" onClick={() => window.history.back()} className="mb-2 w-full rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50">Назад</button>
        <Link to="/dashboard" className="w-full inline-flex items-center justify-center px-4 py-2.5 text-sm font-medium rounded-lg text-white bg-indigo-600 hover:bg-indigo-700 transition-colors">
          <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /></svg>
          Вернуться на главную
        </Link>
      </div>
    </div>
  )
}
