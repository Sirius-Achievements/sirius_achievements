export type ChartTheme = 'light' | 'dark'

export function getChartThemeColors(theme: ChartTheme) {
  const dark = theme === 'dark'

  return {
    accent: dark ? '#b34230' : '#4cbdcf',
    accentStrong: dark ? '#d65a43' : '#2f9fb0',
    accentSoft: dark ? 'rgba(179, 66, 48, 0.22)' : 'rgba(76, 189, 207, 0.16)',
    accentStrongSoft: dark ? 'rgba(214, 90, 67, 0.12)' : 'rgba(47, 159, 176, 0.1)',
    accentMuted: dark ? '#8f3527' : '#78d2df',
    accentMutedSoft: dark ? 'rgba(143, 53, 39, 0.12)' : 'rgba(120, 210, 223, 0.1)',
    pointBackground: dark ? '#0d1113' : '#ffffff',
    text: dark ? '#f7f9f9' : '#334155',
    textMuted: dark ? '#aab3b5' : '#64748b',
    textFaint: dark ? '#7f8b8e' : '#94a3b8',
    grid: dark ? '#273034' : '#e2e8f0',
    tooltip: dark ? '#0d1113' : '#1e293b',
  }
}
