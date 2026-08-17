import { useState } from 'react'

import { bugReportsApi } from '@/api/bugReports'
import { Modal } from '@/components/ui/Modal'

function getEmercomSessionId(): string | undefined {
  // Emercom's collector creates one UUID per browser tab and deliberately
  // exposes it as a public API. Do not read generic storage: it can contain
  // unrelated user data or credentials.
  const scope = window as Window & {
    epoch?: { session?: string }
    __wm?: { session?: string }
  }
  return scope.epoch?.session ?? scope.__wm?.session
}

export function BugReportWidget() {
  const [open, setOpen] = useState(false)
  const [description, setDescription] = useState('')
  const [state, setState] = useState<'idle' | 'sending' | 'success' | 'error'>('idle')

  const close = () => {
    if (state !== 'sending') setOpen(false)
  }

  const submit = async () => {
    setState('sending')
    try {
      await bugReportsApi.create({
        description: description.trim() || undefined,
        page_url: window.location.href,
        session_id: getEmercomSessionId(),
        app_version: __APP_VERSION__,
      })
      setState('success')
      setDescription('')
    } catch {
      setState('error')
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => { setState('idle'); setOpen(true) }}
        className="fixed bottom-5 right-5 z-40 rounded-full bg-indigo-600 px-4 py-3 text-sm font-semibold text-white shadow-lg transition hover:bg-indigo-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
      >
        Сообщить о проблеме
      </button>
      <Modal open={open} onClose={close} title="Сообщить о проблеме" size="sm">
        {state === 'success' ? (
          <div className="space-y-5 py-1">
            <div className="flex gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-indigo-600">
                <svg aria-hidden="true" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="m5 12 4 4L19 6" />
                </svg>
              </div>
              <div>
                <p className="font-semibold text-text">Отчёт отправлен</p>
                <p className="mt-1 text-sm leading-6 text-text-muted">Описание, страница и технический контекст сохранены. Команда сможет открыть точную сессию Emercom.</p>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setState('idle')} className="rounded-lg px-3 py-2 text-sm font-medium text-text-muted transition hover:bg-surface-muted hover:text-text">Ещё отчёт</button>
              <button type="button" onClick={close} className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600">Готово</button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm leading-6 text-text-muted">Кратко опишите, что произошло. Страница, версия и сессия Emercom добавятся автоматически.</p>
            <textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={4000} rows={5} placeholder="Например: после сохранения страница не обновилась" className="w-full resize-none rounded-xl border border-border bg-surface px-3 py-2.5 text-sm text-text outline-none transition placeholder:text-text-muted focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100" />
            {state === 'error' ? <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">Не удалось отправить сообщение. Повторите позже.</p> : null}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={close} className="rounded-lg px-3 py-2 text-sm font-medium text-text-muted transition hover:bg-surface-muted hover:text-text">Отмена</button>
              <button type="button" onClick={() => void submit()} disabled={state === 'sending'} className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600">{state === 'sending' ? 'Отправка…' : 'Отправить'}</button>
            </div>
          </div>
        )}
      </Modal>
    </>
  )
}
