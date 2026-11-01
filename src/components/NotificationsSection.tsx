import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { useSettingsContext } from '../data/SettingsProvider'
import { goToSection, sectionId } from '../lib/settingsSections'
import { browserPushGateway, type PushDevice, type PushState } from '../notifications/pushGateway'
import { rowListStyle } from '../theme/controls'
import { Button, Select } from './controls'

const LEADS = [0, 5, 10, 15, 30, 60, 120, 1440]
const select: CSSProperties = { maxWidth: 320 }
const hint: CSSProperties = { margin: 0, fontSize: 13, opacity: 0.7, lineHeight: 1.45 }
const row: CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }

function leadLabel(minutes: number): string {
  if (minutes === 0) return 'At the Due Moment'
  if (minutes === 60) return '1 hour before'
  if (minutes === 120) return '2 hours before'
  if (minutes === 1440) return '1 day before'
  return `${minutes} minutes before`
}

export function NotificationsSection() {
  const { user } = useAuth()
  const { settings, saveReminderLeadMinutes } = useSettingsContext()
  // Kept with the Account it was read for, like the device list below.
  const [pushRead, setPushRead] = useState<{ accountId: string | null; state: PushState } | null>(
    null,
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // null while loading, 'failed' when the read failed: neither is "no devices". Kept with the
  // Account it was read for, so another Account signing in on this tab never sees it.
  const [read, setRead] = useState<{
    accountId: string
    devices: PushDevice[] | 'failed'
  } | null>(null)
  // Only the newest read may land: one sent before a change can answer after the one sent after.
  // The same holds for this device's push state, which has a counter of its own.
  const latestRead = useRef(0)
  const latestPush = useRef(0)

  // Keyed by the Account: "subscribed" means this Account's subscription, not the browser's.
  const accountId = user?.id ?? null
  const readPush = useCallback(
    async (read: () => Promise<PushState>) => {
      const sequence = ++latestPush.current
      const state = await read()
      if (sequence === latestPush.current) setPushRead({ accountId, state })
    },
    [accountId],
  )
  useEffect(() => {
    void readPush(() =>
      browserPushGateway.state(accountId).catch((): PushState => ({
        availability: 'unsupported',
        permission: 'default',
        subscribed: false,
      })),
    )
  }, [accountId, readPush])
  const push = pushRead && pushRead.accountId === accountId ? pushRead.state : null

  const readDevices = useCallback(async () => {
    if (!accountId) return
    const sequence = ++latestRead.current
    const devices = await browserPushGateway.devices(accountId).catch(() => 'failed' as const)
    if (sequence === latestRead.current) setRead({ accountId, devices })
  }, [accountId])
  useEffect(() => {
    void readDevices()
  }, [readDevices])
  const devices = read && read.accountId === accountId ? read.devices : null

  if (!settings) return null
  const hasConcreteTimezone = settings.timezone !== null

  const changeDevice = async () => {
    if (!user) return
    setBusy(true)
    setError('')
    try {
      if (push?.subscribed) await browserPushGateway.unsubscribe(user.id)
      else await browserPushGateway.subscribe(user.id)
      await readPush(() => browserPushGateway.state(user.id))
      await readDevices()
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Could not update this device.'
      setError(
        /denied/i.test(message)
          ? 'Notifications are blocked. Allow them for Magic Agenda in your browser or system settings, then try again.'
          : message,
      )
    } finally {
      setBusy(false)
    }
  }

  const removeDevice = async (device: PushDevice) => {
    if (!user) return
    setBusy(true)
    setError('')
    try {
      await browserPushGateway.removeDevice(user.id, device.id)
      await readDevices()
    } catch {
      setError(`Could not remove ${device.label}.`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <p style={hint}>
        Reminders are an Account preference, while each browser or installed app subscribes as a
        separate device. Only scheduled, active Tasks are eligible.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <label htmlFor="settings-reminder-lead" style={{ fontSize: 13, opacity: 0.7 }}>
          Reminder timing
        </label>
        <Select
          id="settings-reminder-lead"
          value={settings.reminderLeadMinutes ?? ''}
          disabled={!hasConcreteTimezone}
          onChange={(event) =>
            saveReminderLeadMinutes(event.target.value === '' ? null : Number(event.target.value))
          }
          style={select}
        >
          <option value="">Off</option>
          {LEADS.map((minutes) => (
            <option key={minutes} value={minutes}>
              {leadLabel(minutes)}
            </option>
          ))}
        </Select>
        {!hasConcreteTimezone && (
          <p style={hint}>
            Choose a specific timezone in Dates first. The sender cannot use Automatic because it
            has no browser timezone to follow.
          </p>
        )}
      </div>

      {push?.availability === 'ios-install-required' && (
        <p style={hint}>
          On iPhone and iPad, reminders need the installed app and iOS or iPadOS 16.4 or newer. See{' '}
          <a
            href={`#${sectionId('install')}`}
            onClick={(event) => {
              event.preventDefault()
              goToSection('install')
            }}
            style={{ color: 'inherit' }}
          >
            Install the app
          </a>
          .
        </p>
      )}
      {push?.availability === 'unsupported' && (
        <p style={hint}>This browser does not support Web Push notifications.</p>
      )}
      {push?.availability === 'unconfigured' && (
        <p style={hint}>Push delivery is not configured for this deployment yet.</p>
      )}
      {push?.availability === 'supported' && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 6 }}>
          <Button
            variant={push.subscribed ? 'secondary' : 'primary'}
            disabled={busy || !user}
            onClick={() => void changeDevice()}
          >
            {busy ? 'Updating…' : push.subscribed ? 'Remove this device' : 'Enable on this device'}
          </Button>
          <p style={hint}>
            {push.subscribed
              ? 'This device is subscribed.'
              : 'Permission is requested only when you press the button.'}
          </p>
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ fontSize: 13, opacity: 0.7 }}>Your devices</span>
        {devices === 'failed' && <p style={hint}>Could not load your devices.</p>}
        {Array.isArray(devices) && devices.length === 0 && (
          <p style={hint}>No devices receive reminders.</p>
        )}
        {Array.isArray(devices) && devices.length > 0 && (
          <ul aria-label="Devices with reminders" style={rowListStyle(6)}>
            {devices.map((device) => (
              <li key={device.id} style={row}>
                <span>{device.label}</span>
                <span style={hint}>
                  {[
                    device.current && 'This device',
                    `added ${new Date(device.createdAt).toLocaleDateString()}`,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
                <div style={{ flex: 1 }} />
                {!device.current && (
                  <Button
                    size="sm"
                    variant="danger"
                    disabled={busy}
                    onClick={() => void removeDevice(device)}
                    aria-label={`Remove ${device.label}`}
                  >
                    Remove
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        <p style={hint}>
          Remove a device you no longer use to stop its reminders. This does not sign it out.
          Signing out with the Sign out button also removes the device you are on.
        </p>
      </div>

      {error && (
        <p role="alert" style={{ ...hint, opacity: 1 }}>
          {error}
        </p>
      )}
    </div>
  )
}
