import { ThemeProvider, useTheme } from './theme/ThemeProvider'
import type { ThemeName } from './types/task'
import { TaskCard } from './components/TaskCard'
import { makeMockTasks } from './data/mockTasks'

// TEMPORARY Phase 2 preview — verifies theme parity with mock cards.
// Replaced by the real Board/router in Phase 3.

const THEME_BTNS: { key: ThemeName; label: string; sw: string }[] = [
  { key: 'cork', label: 'Cork', sw: '#caa46b' },
  { key: 'brutal', label: 'Neon', sw: '#FF4D2E' },
  { key: 'glass', label: 'Aurora', sw: '#7c5cff' },
]

function Preview() {
  const { theme, setTheme, conf } = useTheme()
  const tasks = makeMockTasks()
  const scheduled = tasks.filter((t) => t.day !== 'inbox')
  const inbox = tasks.filter((t) => t.day === 'inbox')

  return (
    <div
      style={{
        minHeight: '100%',
        backgroundColor: conf.pageBg,
        backgroundImage: conf.pageImg,
        backgroundSize: conf.pageSize,
        fontFamily: conf.ui,
        padding: '24px 28px 40px',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 14,
          marginBottom: 22,
        }}
      >
        <h1 style={{ fontFamily: conf.title, color: conf.toolbarFg, margin: 0, fontSize: 30 }}>
          Magic Agenda
          <span style={{ opacity: 0.5, fontSize: 16, marginLeft: 10 }}>theme preview · {conf.appName}</span>
        </h1>
        <div
          style={{
            display: 'flex',
            gap: 3,
            padding: 3,
            borderRadius: 11,
            background: 'rgba(0,0,0,.2)',
          }}
        >
          {THEME_BTNS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTheme(t.key)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 13px',
                borderRadius: 8,
                border: 'none',
                cursor: 'pointer',
                fontWeight: 700,
                fontSize: 12.5,
                fontFamily: conf.ui,
                background: theme === t.key ? 'rgba(255,255,255,.2)' : 'transparent',
                color: conf.toolbarFg,
              }}
            >
              <span style={{ width: 11, height: 11, borderRadius: 3, background: t.sw }} />
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <h2 style={{ color: conf.toolbarFg, fontSize: 14, opacity: 0.7, margin: '0 0 10px' }}>
        Calendar cards
      </h2>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))',
          gap: 14,
          marginBottom: 28,
        }}
      >
        {scheduled.map((t) => (
          <TaskCard key={t.id} task={t} variant="cell" />
        ))}
      </div>

      <h2 style={{ color: conf.toolbarFg, fontSize: 14, opacity: 0.7, margin: '0 0 10px' }}>
        Inbox cards
      </h2>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
          gap: 14,
        }}
      >
        {inbox.map((t) => (
          <TaskCard key={t.id} task={t} variant="inbox" />
        ))}
      </div>
    </div>
  )
}

export default function App() {
  return (
    <ThemeProvider>
      <Preview />
    </ThemeProvider>
  )
}
