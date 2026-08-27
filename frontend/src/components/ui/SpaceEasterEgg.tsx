import { useCallback, useEffect, useRef, useState } from 'react'

const REQUIRED_SPACE_PRESSES = 10
const COMBO_RESET_DELAY_MS = 4_000
const MELODY_LOOP_MS = 2_400

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false

  return Boolean(target.closest('input, textarea, select, button, [contenteditable="true"]'))
}

export function SpaceEasterEgg() {
  const [open, setOpen] = useState(false)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const pressCountRef = useRef(0)
  const resetTimerRef = useRef<number | null>(null)
  const melodyTimerRef = useRef<number | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)

  const stopMusic = useCallback(() => {
    if (melodyTimerRef.current !== null) {
      window.clearInterval(melodyTimerRef.current)
      melodyTimerRef.current = null
    }

    const audioContext = audioContextRef.current
    audioContextRef.current = null
    if (audioContext) void audioContext.close()
  }, [])

  const startMusic = useCallback(() => {
    stopMusic()

    const AudioContextConstructor = window.AudioContext
    if (!AudioContextConstructor) return

    const audioContext = new AudioContextConstructor()
    audioContextRef.current = audioContext

    const playMelody = () => {
      if (audioContext.state === 'closed') return

      const notes = [523.25, 659.25, 783.99, 659.25, 587.33, 698.46, 880, 440]
      const startedAt = audioContext.currentTime + 0.03

      notes.forEach((frequency, index) => {
        const oscillator = audioContext.createOscillator()
        const gain = audioContext.createGain()
        const noteStartsAt = startedAt + index * 0.24

        oscillator.type = index % 3 === 2 ? 'sawtooth' : 'square'
        oscillator.frequency.setValueAtTime(frequency, noteStartsAt)
        oscillator.frequency.exponentialRampToValueAtTime(frequency * 0.92, noteStartsAt + 0.17)

        gain.gain.setValueAtTime(0.0001, noteStartsAt)
        gain.gain.exponentialRampToValueAtTime(0.045, noteStartsAt + 0.015)
        gain.gain.exponentialRampToValueAtTime(0.0001, noteStartsAt + 0.18)

        oscillator.connect(gain)
        gain.connect(audioContext.destination)
        oscillator.start(noteStartsAt)
        oscillator.stop(noteStartsAt + 0.19)
      })
    }

    void audioContext.resume().then(playMelody).catch(() => undefined)
    melodyTimerRef.current = window.setInterval(playMelody, MELODY_LOOP_MS)
  }, [stopMusic])

  const close = useCallback(() => {
    setOpen(false)
    stopMusic()
  }, [stopMusic])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && open) {
        event.preventDefault()
        close()
        return
      }

      if (open || event.repeat || (event.code !== 'Space' && event.key !== ' ') || isTypingTarget(event.target)) {
        return
      }

      pressCountRef.current += 1

      if (resetTimerRef.current !== null) window.clearTimeout(resetTimerRef.current)
      resetTimerRef.current = window.setTimeout(() => {
        pressCountRef.current = 0
      }, COMBO_RESET_DELAY_MS)

      if (pressCountRef.current >= REQUIRED_SPACE_PRESSES) {
        event.preventDefault()
        pressCountRef.current = 0
        setOpen(true)
        startMusic()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [close, open, startMusic])

  useEffect(() => {
    if (!open) return

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeButtonRef.current?.focus()

    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [open])

  useEffect(
    () => () => {
      if (resetTimerRef.current !== null) window.clearTimeout(resetTimerRef.current)
      stopMusic()
    },
    [stopMusic],
  )

  if (!open) return null

  return (
    <div
      className="space-easter-egg"
      role="dialog"
      aria-modal="true"
      aria-label="Секретная пасхалка"
      onClick={(event) => {
        if (event.target === event.currentTarget) close()
      }}
    >
      <div className="space-easter-egg__glow" aria-hidden="true" />
      <div className="space-easter-egg__stickers" aria-hidden="true">
        <img className="space-easter-egg__sticker space-easter-egg__sticker--top-left" src="/static/easter-sti.webp" alt="" />
        <img className="space-easter-egg__sticker space-easter-egg__sticker--top-right" src="/static/easter-stice.webp" alt="" />
        <img className="space-easter-egg__sticker space-easter-egg__sticker--bottom-left" src="/static/easter-stick.webp" alt="" />
        <img className="space-easter-egg__sticker space-easter-egg__sticker--bottom-right" src="/static/easter-sticker.webp" alt="" />
      </div>
      <img
        className="space-easter-egg__image"
        src="/static/space-easter-egg.jpg"
        alt="Смешной план дома"
      />
      <div className="space-easter-egg__hand space-easter-egg__hand--six" aria-hidden="true">
        <span className="space-easter-egg__number">6</span>
        <span className="space-easter-egg__palm">🫴</span>
      </div>
      <div className="space-easter-egg__hand space-easter-egg__hand--seven" aria-hidden="true">
        <span className="space-easter-egg__number">7</span>
        <span className="space-easter-egg__palm">🫴</span>
      </div>
      <button
        ref={closeButtonRef}
        type="button"
        className="space-easter-egg__close"
        onClick={close}
        aria-label="Закрыть пасхалку"
      >
        ×
      </button>
      <span className="space-easter-egg__hint">Esc — закрыть</span>
    </div>
  )
}
