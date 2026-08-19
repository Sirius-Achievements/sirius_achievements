import { useTheme } from '@/hooks/useTheme'

interface ThemeToggleProps {
  floating?: boolean
}

export function ThemeToggle({ floating = false }: ThemeToggleProps) {
  const { theme, toggleTheme } = useTheme()
  const nextTheme = theme === 'dark' ? 'light' : 'dark'
  const title = nextTheme === 'dark' ? 'Включить тёмную тему' : 'Включить светлую тему'
  const iconSrc =
    theme === 'dark'
      ? '/static/theme/icons/suntolun-static.svg?v=1.11.13'
      : '/static/theme/icons/luntosun-static.svg?v=1.11.13'

  return (
    <button
      type="button"
      className={floating ? 'theme-toggle-button theme-toggle-floating' : 'theme-toggle-button'}
      data-theme-toggle=""
      aria-label={title}
      aria-pressed={theme === 'dark'}
      title={title}
      onClick={toggleTheme}
    >
      <span className="sr-only">Сменить тему</span>
      <img src={iconSrc} alt="" className="theme-toggle-icon" data-theme-toggle-icon="" />
    </button>
  )
}
