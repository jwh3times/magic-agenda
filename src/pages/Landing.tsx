import { lazy, Suspense, useState } from 'react'
import { Link } from 'react-router'
import type { ThemeName } from '../types/task'
import { useDocumentTitle } from '../lib/useDocumentTitle'
import { useIsMobile } from '../lib/useMediaQuery'

// The preview drags in TaskCard, cardStyles, chrome and the mock board — ~30 kB that the hero,
// the copy, and the CTA do not need. Loading it separately keeps the entry chunk (which every
// visitor pays for, signed in or not) from growing, and the text above the fold paints first.
// The placeholder below reserves its height so nothing shifts when it arrives.
const BoardPreview = lazy(() =>
  import('../components/landing/BoardPreview').then((m) => ({ default: m.BoardPreview })),
)

/**
 * The signed-out home page. Signed-in visitors get `BoardPage` at the same URL (see `HomeRoute`
 * in App.tsx), so there is no URL migration and no bookmark churn.
 *
 * It exists because `/` used to be a login wall, which is why Google's OAuth branding verification
 * fails: the home page did not explain what the app is. Keep it truthful — every claim below is a
 * feature that actually ships.
 *
 * Styling follows the auth pages (`authChrome.ts`), not the board themes: dark violet, so the
 * marketing chrome frames the preview instead of competing with it.
 */

/** Matches the rendered preview's height so the lazy swap causes no layout shift. */
const PREVIEW_HEIGHT = 196

const THEMES: { key: ThemeName; label: string }[] = [
  { key: 'cork', label: 'Cork' },
  { key: 'brutal', label: 'Neon-Brutalist' },
  { key: 'glass', label: 'Aurora-Glass' },
]

const FEATURES = [
  ['Drag and drop', 'Move tasks across days, the week, columns, and the inbox.'],
  ['Four views', 'Calendar, Week, Agenda, and Kanban — pick where you land.'],
  ['Recurring tasks', 'Daily, weekly, or monthly, with this-occurrence vs. all-future edits.'],
  ['Due times and pins', 'Give a task a time, and pin the ones that matter most.'],
  ['Overdue roll-forward', 'Unfinished past-due work is surfaced and moved in one click.'],
  ['Yours alone', 'Every task is private to your account, enforced by the database itself.'],
]

export function Landing() {
  const [theme, setTheme] = useState<ThemeName>('cork')
  const isMobile = useIsMobile()
  useDocumentTitle(
    'Magic Agenda — a drag-and-drop sticky-note task board',
    'A drag-and-drop task board that feels like a corkboard, not a spreadsheet. Three themes, recurring tasks, due times — synced across every device.',
  )

  return (
    <div
      style={{
        minHeight: '100%',
        background:
          'radial-gradient(1200px 600px at 70% -10%, rgba(124,92,255,.25), transparent 60%), #0b0f1f',
        color: '#eaf0ff',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <div
        style={{ maxWidth: 980, margin: '0 auto', padding: isMobile ? '20px 16px' : '28px 24px' }}
      >
        <header
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 16,
          }}
        >
          {/* The app name is real text, not just the logo's alt attribute, and the mark beside it is
              the same one uploaded to the OAuth consent screen. Google's branding verification
              checks that the name on the home page matches the configured app name and that the
              logo identifies the brand — neither can be satisfied by an <img> whose wordmark lives
              inside an SVG the DOM never sees (and which renders lowercase "magic agenda"). */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <img
              src="/apple-touch-icon.png"
              alt=""
              width={32}
              height={32}
              style={{ display: 'block', borderRadius: 8 }}
            />
            <span style={{ fontSize: 19, fontWeight: 800, letterSpacing: '-0.3px' }}>
              Magic Agenda
            </span>
          </div>
          <Link
            to="/login"
            style={{
              color: '#eaf0ff',
              textDecoration: 'none',
              fontSize: 14,
              fontWeight: 700,
              opacity: 0.85,
            }}
          >
            Sign in
          </Link>
        </header>

        <main style={{ textAlign: 'center', padding: isMobile ? '38px 0 8px' : '64px 0 12px' }}>
          <h1
            style={{
              margin: 0,
              fontSize: isMobile ? 34 : 52,
              lineHeight: 1.08,
              letterSpacing: '-1px',
              fontWeight: 800,
            }}
          >
            Your week, on sticky notes.
          </h1>
          <p
            style={{
              margin: '18px auto 0',
              maxWidth: 620,
              fontSize: isMobile ? 16 : 18,
              lineHeight: 1.55,
              opacity: 0.72,
            }}
          >
            Magic Agenda is a drag-and-drop task board that feels like a corkboard, not a
            spreadsheet. Three themes, recurring tasks, due times — synced across every device.
          </p>
          <div
            style={{
              display: 'flex',
              justifyContent: 'center',
              gap: 12,
              marginTop: 28,
              flexWrap: 'wrap',
            }}
          >
            <Link
              to="/login"
              style={{
                padding: '13px 26px',
                borderRadius: 10,
                background: '#7452ff',
                color: '#fff',
                textDecoration: 'none',
                fontSize: 15,
                fontWeight: 800,
              }}
            >
              Get started
            </Link>
          </div>
        </main>

        <section aria-label="Live board preview" style={{ marginTop: isMobile ? 32 : 44 }}>
          <Suspense
            fallback={
              <div
                aria-hidden="true"
                style={{
                  height: PREVIEW_HEIGHT,
                  borderRadius: 14,
                  background: 'rgba(255,255,255,.03)',
                  border: '1px solid rgba(255,255,255,.06)',
                }}
              />
            }
          >
            <BoardPreview theme={theme} />
          </Suspense>
          <div
            style={{
              display: 'flex',
              justifyContent: 'center',
              gap: 8,
              marginTop: 14,
              flexWrap: 'wrap',
            }}
          >
            {THEMES.map((t) => {
              const active = t.key === theme
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setTheme(t.key)}
                  aria-pressed={active}
                  style={{
                    padding: '8px 14px',
                    borderRadius: 999,
                    border: `1px solid ${active ? '#7452ff' : 'rgba(255,255,255,.14)'}`,
                    background: active ? 'rgba(124,92,255,.18)' : 'transparent',
                    color: '#eaf0ff',
                    fontSize: 13,
                    fontWeight: 700,
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                  }}
                >
                  {t.label}
                </button>
              )
            })}
          </div>
          <p style={{ textAlign: 'center', fontSize: 12.5, opacity: 0.45, marginTop: 10 }}>
            A live preview — that is the real board rendering, not a screenshot.
          </p>
        </section>

        <section
          aria-label="Features"
          style={{
            display: 'grid',
            gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, minmax(0, 1fr))',
            gap: isMobile ? 18 : 26,
            margin: isMobile ? '40px 0 8px' : '64px 0 16px',
          }}
        >
          {FEATURES.map(([title, body]) => (
            <div key={title}>
              <h2 style={{ margin: '0 0 6px', fontSize: 15, fontWeight: 800 }}>{title}</h2>
              <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, opacity: 0.65 }}>{body}</p>
            </div>
          ))}
        </section>

        <footer
          style={{
            marginTop: isMobile ? 36 : 56,
            paddingTop: 18,
            borderTop: '1px solid rgba(255,255,255,.08)',
            display: 'flex',
            justifyContent: 'space-between',
            gap: 12,
            flexWrap: 'wrap',
            fontSize: 12.5,
            opacity: 0.5,
          }}
        >
          <span>© {new Date().getFullYear()} Magic Agenda</span>
          <span style={{ display: 'flex', gap: 14 }}>
            <Link to="/privacy" style={{ color: 'inherit' }}>
              Privacy
            </Link>
            <Link to="/terms" style={{ color: 'inherit' }}>
              Terms
            </Link>
          </span>
        </footer>
      </div>
    </div>
  )
}
