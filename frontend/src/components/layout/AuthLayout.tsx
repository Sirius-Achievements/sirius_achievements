import { lazy, Suspense, useEffect } from 'react'
import { Outlet, useLocation } from 'react-router-dom'

import { ThemeToggle } from '@/components/ui/ThemeToggle'

const InteractiveLogo3D = lazy(() =>
  import('@/components/auth/InteractiveLogo3D').then((module) => ({ default: module.InteractiveLogo3D })),
)

export function AuthLayout() {
  const location = useLocation()
  const isPrivacyPage = location.pathname.endsWith('/privacy')

  useEffect(() => {
    const previousClassName = document.body.className
    document.body.className = 'theme-auth-page antialiased font-sans min-h-screen'

    return () => {
      document.body.className = previousClassName
    }
  }, [])

  return (
    <main className={`auth-portal${isPrivacyPage ? ' auth-portal--document' : ''}`}>
      <ThemeToggle floating />

      {isPrivacyPage ? (
        <div className="auth-portal__document">
          <Outlet />
        </div>
      ) : (
        <div className="auth-portal__card">
          <section className="auth-portal__brand" aria-label="Sirius Achievements">
            <div className="auth-portal__model-wrap">
              <Suspense fallback={<span className="auth-logo-3d__loader" aria-hidden="true" />}>
                <InteractiveLogo3D />
              </Suspense>
              <span className="auth-portal__model-shadow" aria-hidden="true" />
            </div>

            <div className="auth-portal__wordmark">
              <span>Sirius</span>
              <span>Achievements</span>
            </div>
          </section>

          <section className="auth-portal__form" aria-label="Авторизация">
            <Outlet />
          </section>
        </div>
      )}
    </main>
  )
}
