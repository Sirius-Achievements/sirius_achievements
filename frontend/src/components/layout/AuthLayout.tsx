import { useEffect } from 'react'
import { Outlet } from 'react-router-dom'

import { ThemeToggle } from '@/components/ui/ThemeToggle'

export function AuthLayout() {
  useEffect(() => {
    const previousClassName = document.body.className
    document.body.className = 'theme-auth-page bg-slate-50 antialiased font-sans min-h-screen flex items-center justify-center p-4'

    return () => {
      document.body.className = previousClassName
    }
  }, [])

  return (
    <div className="flex flex-1 min-h-[100dvh] items-center justify-center p-4">
      <ThemeToggle floating />
      <Outlet />
    </div>
  )
}
