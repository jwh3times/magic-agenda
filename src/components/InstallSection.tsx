import type { CSSProperties, ReactNode } from 'react'
import { useInstallGuidance } from '../install/useInstallGuidance'
import { Button } from './controls'

const hint: CSSProperties = { margin: 0, fontSize: 13, opacity: 0.7, lineHeight: 1.45 }
const text: CSSProperties = { margin: 0, lineHeight: 1.45 }
const column: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 10 }
const icon: CSSProperties = { verticalAlign: '-4px', margin: '0 4px' }

/** Drawn here rather than loaded, so the steps need no network and no new CSP source. */
function ShareIcon() {
  return (
    <svg
      aria-hidden="true"
      width="18"
      height="18"
      viewBox="0 0 18 18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={icon}
    >
      <path d="M5.5 7H4v9.5h10V7h-1.5" />
      <path d="M9 11.5V1.5M6 4.5l3-3 3 3" />
    </svg>
  )
}

function AddIcon() {
  return (
    <svg
      aria-hidden="true"
      width="18"
      height="18"
      viewBox="0 0 18 18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={icon}
    >
      <rect x="2" y="2" width="14" height="14" rx="3.5" />
      <path d="M9 5.5v7M5.5 9h7" />
    </svg>
  )
}

function IosSteps() {
  return (
    <ol
      aria-label="Steps to install on iPhone or iPad"
      style={{ ...column, ...text, paddingLeft: 22 }}
    >
      <li>
        Tap
        <ShareIcon />
        <strong>Share</strong>. If you can't see it, tap the <strong>⋯</strong> button first.
      </li>
      <li>
        Tap
        <AddIcon />
        <strong>Add to Home Screen</strong>. You may need to scroll down or tap{' '}
        <strong>More</strong> to find it.
      </li>
      <li>
        Tap <strong>Add</strong>.
      </li>
      <li>Open Magic Agenda from your Home Screen.</li>
    </ol>
  )
}

function Intro({ children }: { children: ReactNode }) {
  return <p style={hint}>{children}</p>
}

const INTRO =
  'Installing puts Magic Agenda on your Home Screen, so it opens in its own window like any other app.'

export function InstallSection() {
  const { guidance, install } = useInstallGuidance()

  switch (guidance.kind) {
    case 'in-installed-app':
      return <p style={text}>You're using the installed app, so there's nothing more to do.</p>
    case 'just-installed':
      return (
        <p style={text}>Magic Agenda is installed. Open it from your Home Screen or app list.</p>
      )
    case 'prompt':
      return (
        <div style={{ ...column, alignItems: 'flex-start' }}>
          <Intro>{INTRO}</Intro>
          <Button variant="primary" onClick={() => void install()}>
            Install the app
          </Button>
          <Intro>Your browser will ask you to confirm.</Intro>
        </div>
      )
    case 'ios':
      return (
        <div style={column}>
          <Intro>{INTRO}</Intro>
          {guidance.inAppBrowser && (
            <p style={text}>
              You're in another app's built-in browser, which can't install anything. Open this page
              in Safari first, usually from this app's ⋯ or Share menu.
            </p>
          )}
          <IosSteps />
        </div>
      )
    case 'steps':
      return (
        <div style={column}>
          <Intro>{INTRO}</Intro>
          {guidance.inAppBrowser && (
            <p style={text}>
              You're in another app's built-in browser, which can't install anything. Open this page
              in your usual browser first, usually from this app's menu.
            </p>
          )}
          <p style={text}>
            Open your browser's menu and choose <strong>Install app</strong>, or the option that
            puts it on your home screen. On a computer, it may be at the end of the address bar. Not
            every browser offers this, and Magic Agenda works the same here in the browser.
          </p>
        </div>
      )
  }
}
