import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'

const SCRIPT_ID = 'magic-agenda-turnstile'
const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'

interface TurnstileRenderOptions {
  sitekey: string
  theme: 'dark'
  action: 'turnstile-spin-v1'
  callback: (token: string) => void
  'expired-callback': () => void
  'error-callback': () => void
}

interface TurnstileApi {
  ready(callback: () => void): void
  render(container: HTMLElement, options: TurnstileRenderOptions): string
  reset(widgetId: string): void
  remove(widgetId: string): void
}

declare global {
  interface Window {
    turnstile?: TurnstileApi
  }
}

export interface TurnstileWidgetHandle {
  reset(): void
}

function whenTurnstileReady(): Promise<TurnstileApi> {
  return new Promise((resolve, reject) => {
    const fail = (script: HTMLScriptElement, message: string) => {
      script.remove()
      reject(new Error(message))
    }

    const finish = () => {
      const api = window.turnstile
      if (!api) {
        const script = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null
        if (script) fail(script, 'Turnstile loaded without its browser API')
        else reject(new Error('Turnstile loaded without its browser API'))
        return
      }
      api.ready(() => resolve(api))
    }

    if (window.turnstile) {
      finish()
      return
    }

    const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null
    const script = existing ?? document.createElement('script')
    script.addEventListener('load', finish, { once: true })
    script.addEventListener('error', () => fail(script, 'Turnstile failed to load'), { once: true })

    if (!existing) {
      script.id = SCRIPT_ID
      script.src = SCRIPT_SRC
      script.defer = true
      document.head.append(script)
    }
  })
}

/** Explicit rendering keeps the challenge lifecycle aligned with Login's conditional SPA forms. */
export const TurnstileWidget = forwardRef<
  TurnstileWidgetHandle,
  { onToken: (token: string | null) => void; onError: () => void }
>(function TurnstileWidget({ onToken, onError }, ref) {
  const containerRef = useRef<HTMLDivElement>(null)
  const apiRef = useRef<TurnstileApi | null>(null)
  const widgetIdRef = useRef<string | null>(null)

  useImperativeHandle(
    ref,
    () => ({
      reset() {
        if (apiRef.current && widgetIdRef.current) apiRef.current.reset(widgetIdRef.current)
      },
    }),
    [],
  )

  useEffect(() => {
    let active = true
    const container = containerRef.current
    if (!container || !import.meta.env.VITE_TURNSTILE_SITE_KEY) {
      onError()
      return
    }

    void whenTurnstileReady()
      .then((api) => {
        if (!active) return
        apiRef.current = api
        widgetIdRef.current = api.render(container, {
          sitekey: import.meta.env.VITE_TURNSTILE_SITE_KEY,
          theme: 'dark',
          action: 'turnstile-spin-v1',
          callback: (token) => onToken(token),
          'expired-callback': () => onToken(null),
          'error-callback': () => {
            onToken(null)
            onError()
          },
        })
      })
      .catch(() => {
        if (active) onError()
      })

    return () => {
      active = false
      if (apiRef.current && widgetIdRef.current) apiRef.current.remove(widgetIdRef.current)
      apiRef.current = null
      widgetIdRef.current = null
    }
  }, [onError, onToken])

  return <div ref={containerRef} aria-label="Security verification" />
})
