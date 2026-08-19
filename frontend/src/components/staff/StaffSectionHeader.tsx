import { Link } from 'react-router-dom'

import { cn } from '@/utils/cn'

export type StaffSectionKind = 'users' | 'documents' | 'support'
export type StaffSectionView = 'all' | 'my' | 'incoming'

interface StaffSectionHeaderProps {
  kind: StaffSectionKind
  currentView: StaffSectionView
  title: string
  description: string
}

interface StaffSectionLink {
  key: StaffSectionView
  title: string
  description: string
  to: string
}

const sectionLabels: Record<StaffSectionKind, string> = {
  users: 'Пользователи',
  documents: 'Документы',
  support: 'Обращения',
}

const sectionLinks: Record<StaffSectionKind, StaffSectionLink[]> = {
  users: [
    {
      key: 'all',
      title: 'Все пользователи',
      description: 'Полный список аккаунтов',
      to: '/users',
    },
    {
      key: 'my',
      title: 'Мои пользователи',
      description: 'Закреплённые за вами',
      to: '/my-work?tab=users',
    },
    {
      key: 'incoming',
      title: 'Новые пользователи',
      description: 'Очередь на проверку',
      to: '/moderation/users',
    },
  ],
  documents: [
    {
      key: 'all',
      title: 'Все документы',
      description: 'Полная база достижений',
      to: '/documents',
    },
    {
      key: 'my',
      title: 'Мои документы',
      description: 'Документы в работе',
      to: '/my-work?tab=achievements',
    },
    {
      key: 'incoming',
      title: 'Новые документы',
      description: 'Входящие на модерацию',
      to: '/moderation/achievements',
    },
  ],
  support: [
    {
      key: 'all',
      title: 'Все обращения',
      description: 'Открытые и закрытые обращения',
      to: '/moderation/support?tab=all',
    },
    {
      key: 'my',
      title: 'Мои чаты',
      description: 'Обращения в работе',
      to: '/moderation/support?tab=chats',
    },
    {
      key: 'incoming',
      title: 'Новые обращения',
      description: 'Свободные входящие',
      to: '/moderation/support',
    },
  ],
}

export function StaffSectionHeader({ kind, currentView, title, description }: StaffSectionHeaderProps) {
  return (
    <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
      <div className="space-y-1">
        <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-slate-400">
          {sectionLabels[kind]}
        </p>
        <h2 className="text-2xl font-bold tracking-tight text-slate-800">{title}</h2>
        <p className="text-sm text-slate-500">{description}</p>
      </div>

      <div className="grid gap-2 sm:grid-cols-3 xl:min-w-[520px]">
        {sectionLinks[kind].map((item) => {
          const isActive = item.key === currentView

          return (
            <Link
              key={item.key}
              to={item.to}
              className={cn(
                'staff-section-card rounded-2xl border px-4 py-3 transition-all',
                isActive
                  ? 'staff-section-card--active border-indigo-500 bg-indigo-600 text-white shadow-sm shadow-indigo-600/20'
                  : 'border-slate-200 bg-surface text-slate-700 hover:border-indigo-200 hover:bg-indigo-50/50',
              )}
            >
              <span className="block text-sm font-semibold">{item.title}</span>
              <span className={cn('mt-1 block text-xs', isActive ? 'text-indigo-100' : 'text-slate-500')}>
                {item.description}
              </span>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
