import { Link } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { roleLabel } from '@/utils/labels'

export function ForbiddenPage() {
  const { user } = useAuth()
  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center text-center px-4">
      <div className="bg-surface p-8 md:p-10 rounded-2xl shadow-sm border border-slate-200 max-w-md w-full flex flex-col items-center">
        <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center mb-5">
          <svg className="w-8 h-8 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
        </div>
        <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight mb-2">403</h1>
        <h2 className="text-lg font-bold text-slate-800 mb-2">Недостаточно прав</h2>
        <p className="text-sm text-slate-500 mb-3 leading-relaxed">Для этого раздела нужна роль сотрудника с соответствующими правами.</p>
        <p className="mb-6 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">Ваша роль: <strong>{user ? roleLabel(user.role) : 'гость'}</strong></p>
        <button type="button" onClick={() => window.history.back()} className="mb-2 w-full rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50">Вернуться назад</button>
        <Link to="/support" className="mb-2 w-full rounded-lg border border-indigo-200 px-4 py-2.5 text-sm font-medium text-indigo-600 hover:bg-indigo-50">Запросить доступ</Link>
        <Link to="/dashboard" className="w-full inline-flex items-center justify-center px-4 py-2.5 text-sm font-medium rounded-lg text-white bg-indigo-600 hover:bg-indigo-700 transition-colors">
          <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /></svg>
          Вернуться на главную
        </Link>
      </div>
    </div>
  )
}
