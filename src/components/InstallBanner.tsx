import { useEffect, useState } from 'react'
import { readInstallBannerDismissed, writeInstallBannerDismissed } from '../install/bannerDismissal'
import { shouldSuggestInstalling } from '../install/guidance'
import { useInstallGuidance } from '../install/useInstallGuidance'
import { useTheme } from '../theme/ThemeProvider'
import { Button, LinkButton } from './controls'

/** The suggestion to install, on a phone-width Board. It sits in the page, so nothing waits on it. */
export function InstallBanner() {
  const { conf } = useTheme()
  const { guidance, install } = useInstallGuidance()
  const [dismissed, setDismissed] = useState(readInstallBannerDismissed)

  // "Installed from this tab" isn't stored, so a reload there would otherwise suggest it again.
  const justInstalled = guidance.kind === 'just-installed'
  useEffect(() => {
    if (justInstalled) writeInstallBannerDismissed()
  }, [justInstalled])

  if (dismissed || !shouldSuggestInstalling(guidance)) return null

  return (
    <section
      aria-label="Install the app"
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: '8px 10px',
        margin: '8px 10px 0',
        padding: '8px 12px',
        borderRadius: conf.cellRadius,
        background: conf.cellToday,
        color: conf.numFg,
        border: conf.cellBorder,
        fontFamily: conf.ui,
        fontSize: 13.5,
        lineHeight: 1.4,
        position: 'relative',
        zIndex: 1,
      }}
    >
      <p style={{ margin: 0, flex: '1 1 100%' }}>
        <strong style={{ fontWeight: 700 }}>Install the app</strong> so Magic Agenda opens in its
        own window, like any other app.
      </p>
      {guidance.kind === 'prompt' ? (
        <Button variant="primary" size="sm" onClick={() => void install()}>
          Install the app
        </Button>
      ) : (
        <LinkButton
          to="/settings"
          state={{ section: 'install' }}
          variant="primary"
          size="sm"
          style={{ textDecoration: 'none' }}
        >
          See how
        </LinkButton>
      )}
      <Button
        size="sm"
        onClick={() => {
          writeInstallBannerDismissed()
          setDismissed(true)
        }}
      >
        Dismiss
      </Button>
    </section>
  )
}
