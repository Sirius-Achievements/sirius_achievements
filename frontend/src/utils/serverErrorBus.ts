export interface ServerErrorDetail {
  status: number
  url?: string
}

type Listener = (detail: ServerErrorDetail) => void

const listeners = new Set<Listener>()
let lastEmit = 0

// Debounce window: a broken backend usually fails many parallel requests
// at once; surface at most one toast per interval so the UI is not flooded.
const EMIT_DEBOUNCE_MS = 5000

export function onServerError(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function emitServerError(detail: ServerErrorDetail): void {
  const now = Date.now()
  if (now - lastEmit < EMIT_DEBOUNCE_MS) {
    return
  }
  lastEmit = now
  listeners.forEach((listener) => listener(detail))
}
