import { LegalLayout } from '../components/LegalLayout'

const a = { color: '#a78bfa' }

export function Terms() {
  return (
    <LegalLayout title="Terms of Service" lastUpdated="June 29, 2026">
      <p>
        These terms govern your use of Magic Agenda (“the service”) at{' '}
        <a href="https://magicagenda.app" style={a}>
          magicagenda.app
        </a>
        . By creating an account or using the service, you agree to them. If you don’t agree, please
        don’t use the service.
      </p>

      <h2>The service</h2>
      <p>
        Magic Agenda is a personal task‑board app for organizing your own tasks. It’s offered for
        personal, non‑commercial use.
      </p>

      <h2>Your account</h2>
      <p>
        You’re responsible for keeping your login credentials secure and for activity under your
        account. Provide accurate information when signing up, and let us know promptly if you
        suspect unauthorized use.
      </p>

      <h2>Acceptable use</h2>
      <p>You agree not to:</p>
      <ul>
        <li>use the service for unlawful purposes or to store unlawful content;</li>
        <li>attempt to access other users’ data or disrupt, overload, or probe the service;</li>
        <li>reverse‑engineer or abuse the service in ways that harm it or other users.</li>
      </ul>

      <h2>Your content</h2>
      <p>
        You own the content you create. You grant us a limited license to store, process, and
        display it solely to provide the service to you. You’re responsible for your content.
      </p>

      <h2>Availability &amp; changes</h2>
      <p>
        The service is provided on an “as is” and “as available” basis. We may modify, suspend, or
        discontinue features at any time, and we don’t guarantee uninterrupted availability. We may
        update these terms; continued use after a change means you accept the updated terms.
      </p>

      <h2>Disclaimer &amp; limitation of liability</h2>
      <p>
        To the maximum extent permitted by law, the service is provided without warranties of any
        kind, and we are not liable for any indirect, incidental, or consequential damages, or for
        loss of data, arising from your use of the service. Please keep your own backups of anything
        important.
      </p>

      <h2>Termination</h2>
      <p>
        You may stop using the service and delete your account at any time (see the{' '}
        <a href="/privacy" style={a}>
          Privacy Policy
        </a>
        ). We may suspend or terminate access that violates these terms.
      </p>

      <h2>Governing law</h2>
      <p>
        These terms are governed by the laws of the jurisdiction in which the operator resides,
        without regard to conflict‑of‑law rules.
      </p>
    </LegalLayout>
  )
}
