import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { Link, Navigate } from 'react-router'
import { ThemeProvider, useTheme } from '../theme/ThemeProvider'
import { Spinner } from '../components/Spinner'
import { useSettingsContext } from '../data/SettingsProvider'
import { useIsMobile } from '../lib/useMediaQuery'
import { useRole } from '../access/useRole'
import { useFlags, type FeatureFlag } from '../access/useFlags'
import {
  loadAdminStats,
  loadAdminUsers,
  saveFeatureFlag,
  type AdminResult,
  type AdminStats,
  type AdminUserPage,
} from '../admin/adminApi'

export const ADMIN_PAGE_SIZE = 25

const FORBIDDEN_MESSAGE =
  'Administration needs an admin role and a two-factor session. Turn on two-factor authentication in Settings, then sign in again.'

/**
 * The protected /admin route (#274): aggregate statistics, the account list, and flag toggles.
 *
 * The role check below only decides what to render. The database is the boundary: the RPCs refuse
 * anyone who is not a live admin on an `aal2` session, and this page shows that refusal rather
 * than working around it. By design there is no way from here to any Account's Task content.
 */
export function AdminPage() {
  const { isAdmin, loading } = useRole()
  const { settings, loading: settingsLoading } = useSettingsContext()
  if (loading && !isAdmin) return <Spinner />
  if (!isAdmin) return <Navigate to="/" replace />
  if (settingsLoading || !settings) return <Spinner />
  return (
    <ThemeProvider initial={settings.theme}>
      <AdminShell />
    </ThemeProvider>
  )
}

function AdminShell() {
  const { conf } = useTheme()
  const isMobile = useIsMobile()
  const card: CSSProperties = {
    background: conf.cellBg,
    border: conf.cellBorder,
    borderRadius: conf.cellRadius,
    padding: isMobile ? 14 : 18,
    overflowX: 'auto',
  }
  const section = (id: string, title: string, body: ReactNode) => (
    <section aria-labelledby={`admin-${id}`} style={card}>
      <h2 id={`admin-${id}`} style={{ margin: '0 0 12px', fontSize: 17, fontFamily: conf.title }}>
        {title}
      </h2>
      {body}
    </section>
  )

  return (
    <div
      style={{
        minHeight: '100%',
        background: conf.pageBg,
        backgroundImage: conf.pageImg,
        backgroundSize: conf.pageSize,
        fontFamily: conf.ui,
        color: conf.numFg,
        padding: isMobile ? 14 : 28,
      }}
    >
      <div
        style={{
          maxWidth: 820,
          margin: '0 auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}
      >
        <header style={{ display: 'flex', alignItems: 'baseline', gap: 16 }}>
          <Link
            to="/settings"
            style={{ color: 'inherit', textDecoration: 'none', fontWeight: 700 }}
          >
            ← Settings
          </Link>
          <h1 style={{ fontFamily: conf.title, fontSize: isMobile ? 26 : 32, margin: 0 }}>Admin</h1>
        </header>
        <p style={{ margin: 0, fontSize: 13, opacity: 0.75 }}>
          Counts only. This page never shows what anyone has written in their Tasks.
        </p>
        <main style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {section('overview', 'Overview', <StatsSection />)}
          {section('accounts', 'Accounts', <AccountsSection />)}
          {section('flags', 'Feature flags', <FlagsSection />)}
        </main>
      </div>
    </div>
  )
}

function Refusal({ result }: { result: Extract<AdminResult<unknown>, { ok: false }> }) {
  return (
    <p role="alert" style={{ margin: 0 }}>
      {result.reason === 'forbidden'
        ? FORBIDDEN_MESSAGE
        : `Could not load this section: ${result.message}`}
    </p>
  )
}

const cell: CSSProperties = { padding: '4px 8px', textAlign: 'left', whiteSpace: 'nowrap' }
const numeric: CSSProperties = { ...cell, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }

function StatsSection() {
  const [result, setResult] = useState<AdminResult<AdminStats> | null>(null)
  useEffect(() => {
    let cancelled = false
    void loadAdminStats().then((next) => {
      if (!cancelled) setResult(next)
    })
    return () => {
      cancelled = true
    }
  }, [])

  if (!result) return <Spinner label="Loading statistics…" />
  if (!result.ok) return <Refusal result={result} />
  const stats = result.data
  const tiles: [string, number][] = [
    ['Accounts', stats.accounts],
    ['Signed in, last 30 days', stats.activeAccounts30d],
    ['With two-factor', stats.accountsWithMfa],
    ['Boards', stats.boards],
    ['Tasks', stats.tasks],
    ['Completed Tasks', stats.completedTasks],
    ['Recurring series', stats.series],
  ]
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <dl
        style={{
          margin: 0,
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
          gap: 12,
        }}
      >
        {tiles.map(([label, value]) => (
          <div key={label}>
            <dt style={{ fontSize: 13, opacity: 0.7 }}>{label}</dt>
            <dd style={{ margin: 0, fontSize: 24, fontWeight: 700 }}>{value}</dd>
          </div>
        ))}
      </dl>
      <details>
        <summary style={{ cursor: 'pointer' }}>Last 30 days (UTC)</summary>
        <table style={{ borderCollapse: 'collapse', marginTop: 8, fontSize: 14 }}>
          <thead>
            <tr>
              <th style={cell}>Day</th>
              <th style={numeric}>New accounts</th>
              <th style={numeric}>New Tasks</th>
            </tr>
          </thead>
          <tbody>
            {[...stats.daily].reverse().map((d) => (
              <tr key={d.day}>
                <td style={cell}>{d.day}</td>
                <td style={numeric}>{d.newAccounts}</td>
                <td style={numeric}>{d.newTasks}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  )
}

const utcDay = (instant: string | null) => (instant ? instant.slice(0, 10) : 'Never')

function AccountsSection() {
  const [page, setPage] = useState(0)
  const [loaded, setLoaded] = useState<{
    page: number
    result: AdminResult<AdminUserPage>
  } | null>(null)
  useEffect(() => {
    let cancelled = false
    void loadAdminUsers(page, ADMIN_PAGE_SIZE).then((result) => {
      if (!cancelled) setLoaded({ page, result })
    })
    return () => {
      cancelled = true
    }
  }, [page])

  if (!loaded || loaded.page !== page) return <Spinner label="Loading accounts…" />
  if (!loaded.result.ok) return <Refusal result={loaded.result} />
  const { users, total } = loaded.result.data
  const pages = Math.max(1, Math.ceil(total / ADMIN_PAGE_SIZE))
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <table style={{ borderCollapse: 'collapse', fontSize: 14 }}>
        <thead>
          <tr>
            <th style={cell}>Email</th>
            <th style={cell}>Joined (UTC)</th>
            <th style={cell}>Last sign-in (UTC)</th>
            <th style={cell}>Two-factor</th>
            <th style={cell}>Role</th>
            <th style={numeric}>Boards</th>
            <th style={numeric}>Tasks</th>
          </tr>
        </thead>
        <tbody>
          {users.map((user) => (
            <tr key={user.id}>
              <td style={cell}>{user.email}</td>
              <td style={cell}>{utcDay(user.createdAt)}</td>
              <td style={cell}>{utcDay(user.lastSignInAt)}</td>
              <td style={cell}>{user.hasMfa ? 'On' : 'Off'}</td>
              <td style={cell}>{user.isAdmin ? 'Admin' : 'Member'}</td>
              <td style={numeric}>{user.ownedBoards}</td>
              <td style={numeric}>{user.ownedTasks}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <nav aria-label="Account pages" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button type="button" disabled={page === 0} onClick={() => setPage(page - 1)}>
          Previous
        </button>
        <span>
          Page {page + 1} of {pages} · {total} accounts
        </span>
        <button type="button" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>
          Next
        </button>
      </nav>
    </div>
  )
}

function FlagsSection() {
  const { flags, loading, reload } = useFlags()
  if (loading && flags.length === 0) return <Spinner label="Loading flags…" />
  if (flags.length === 0) {
    return (
      <p style={{ margin: 0 }}>
        No flags are defined. Flags are created in SQL; see the roles and feature flags runbook.
      </p>
    )
  }
  return (
    <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 12 }}>
      {flags.map((flag) => (
        <FlagRow key={flag.key} flag={flag} onSaved={() => void reload()} />
      ))}
    </ul>
  )
}

function FlagRow({ flag, onSaved }: { flag: FeatureFlag; onSaved: () => void }) {
  const [description, setDescription] = useState(flag.description)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async (patch: Partial<Pick<FeatureFlag, 'enabled' | 'description'>>) => {
    setPending(true)
    setError(null)
    const result = await saveFeatureFlag(flag.key, patch)
    setPending(false)
    if (!result.ok) {
      setError(result.reason === 'forbidden' ? FORBIDDEN_MESSAGE : result.message)
      return
    }
    onSaved()
  }

  return (
    <li style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700 }}>
        <input
          type="checkbox"
          checked={flag.enabled}
          disabled={pending}
          onChange={(e) => void save({ enabled: e.target.checked })}
        />
        <code>{flag.key}</code>
      </label>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <input
          aria-label={`Description for ${flag.key}`}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          style={{ fontSize: 16, padding: '6px 8px', flex: '1 1 240px' }}
        />
        <button
          type="button"
          disabled={pending || description === flag.description}
          onClick={() => void save({ description })}
        >
          Save description
        </button>
      </div>
      {error && (
        <p role="alert" style={{ margin: 0 }}>
          {error}
        </p>
      )}
    </li>
  )
}
