import { useState } from 'react'

import { bugReportsApi } from '@/api/bugReports'
import { Modal } from '@/components/ui/Modal'

function getEmercomSessionId(): string | undefined {
  // The collector may expose an id under different names; never read form values
  // or storage, which could contain personal data or credentials.
  const scope = window as Window & { emercom?: { sessionId?: string }; __emercomSessionId?: string }
  return scope.emercom?.sessionId ?? scope.__emercomSessionId
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
          <p className="text-sm text-emerald-700">Спасибо. Контекст текущей страницы сохранён вместе с сообщением.</p>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-text-muted">Опишите, что произошло. Адрес страницы и технический контекст добавятся автоматически.</p>
            <textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={4000} rows={5} placeholder="Описание — необязательно" className="w-full rounded-lg border border-border px-3 py-2 text-sm" />
            {state === 'error' ? <p className="text-sm text-red-600">Не удалось отправить сообщение. Повторите позже.</p> : null}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={close} className="rounded-lg px-3 py-2 text-sm text-text-muted">Отмена</button>
              <button type="button" onClick={() => void submit()} disabled={state === 'sending'} className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60">{state === 'sending' ? 'Отправка…' : 'Отправить'}</button>
            </div>
          </div>
        )}
      </Modal>
    </>
  )
}
