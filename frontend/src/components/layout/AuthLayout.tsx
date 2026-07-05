import { useEffect } from 'react'
import { Link, Outlet } from 'react-router-dom'

import { ThemeToggle } from '@/components/ui/ThemeToggle'
import { AuthHero } from './AuthHero'

export function AuthLayout() {
  useEffect(() => {
    const previousClassName = document.body.className
    document.body.className = 'theme-auth-page bg-slate-50 antialiased font-sans min-h-screen'

    return () => {
      document.body.className = previousClassName
    }
  }, [])

  return (
    <div className="auth-shell relative flex flex-1 min-h-[100dvh] flex-col lg:flex-row">
      {/* Desktop-only vivid backdrop behind both columns. Hidden on mobile so the
          phone layout keeps its plain light background exactly as before. */}
      <div className="auth-bg hidden lg:block" aria-hidden />

      <ThemeToggle floating />

      {/* Form column — holds the existing auth card via <Outlet />. */}
      <div className="auth-form-col relative z-10 flex flex-1 flex-col items-center justify-center p-4 lg:w-[46%] lg:flex-none lg:px-10">
        <div className="flex w-full flex-1 items-center justify-center">
          <Outlet />
        </div>
        <div className="auth-form-foot hidden lg:flex">
          <Link to="/privacy" className="auth-form-foot__link">
            Политика конфиденциальности
          </Link>
          <span className="auth-form-foot__dot">·</span>
          <span>© Университет «Сириус», {new Date().getFullYear()}</span>
        </div>
      </div>

      {/* Decorative hero column (desktop only). */}
      <AuthHero />
    </div>
  )
}
