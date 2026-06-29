import { LegalLayout } from '../components/LegalLayout'

const a = { color: '#a78bfa' }

export function Privacy() {
  return (
    <LegalLayout title="Privacy Policy" lastUpdated="June 29, 2026">
      <p>
        Magic Agenda (“we”, “us”) is a personal task‑board web app available at{' '}
        <a href="https://magicagenda.app" style={a}>
          magicagenda.app
        </a>
        . This policy explains what we collect, why, and your choices. We try to collect as little
        as possible.
      </p>

      <h2>Information we collect</h2>
      <ul>
        <li>
          <strong>Account information.</strong> If you sign up with email and password, we store
          your email address. If you sign in with Google, we receive your basic Google profile
          (name, email address, and profile picture). We never receive your Google password.
        </li>
        <li>
          <strong>Your content.</strong> The tasks, descriptions, checklists, categories, schedules,
          and preferences (theme, default view) you create in the app.
        </li>
        <li>
          <strong>Technical data.</strong> A session token stored in your browser’s local storage to
          keep you signed in, and standard request logs kept by our infrastructure providers (for
          security and reliability).
        </li>
      </ul>

      <h2>How we use it</h2>
      <p>
        We use your information solely to provide the service — to authenticate you, store and sync
        your tasks across your devices, and keep the app secure and working. We do{' '}
        <strong>not</strong> sell your data, and we do not use it for advertising or profiling.
      </p>

      <h2>Service providers</h2>
      <p>Your data is processed by a small number of providers that run the app:</p>
      <ul>
        <li>
          <strong>Supabase</strong> — database and authentication; stores your account and your
          tasks.
        </li>
        <li>
          <strong>Google</strong> — only if you choose “Continue with Google”, to authenticate you.
        </li>
        <li>
          <strong>Cloudflare</strong> — hosting and content delivery for the website.
        </li>
      </ul>
      <p>
        We share data with these providers only to operate the service, and otherwise only if
        required by law.
      </p>

      <h2>Security</h2>
      <p>
        Data is transmitted over HTTPS. Each account’s data is isolated at the database level using
        row‑level security, so one user cannot read or modify another user’s data. No method of
        storage or transmission is perfectly secure, but we take reasonable measures to protect your
        data.
      </p>

      <h2>Data retention &amp; your choices</h2>
      <p>
        You can edit or delete your tasks at any time within the app. To delete your account and all
        associated data, email{' '}
        <a href="mailto:jerryholland00@gmail.com" style={a}>
          jerryholland00@gmail.com
        </a>{' '}
        and we’ll remove it promptly. You may also revoke Magic Agenda’s access to your Google
        account from your{' '}
        <a href="https://myaccount.google.com/permissions" style={a}>
          Google account permissions
        </a>
        .
      </p>

      <h2>Children</h2>
      <p>
        Magic Agenda is not directed to children under 13 (or the minimum age in your country), and
        we do not knowingly collect their data.
      </p>

      <h2>Changes</h2>
      <p>
        We may update this policy; we’ll revise the “Last updated” date above. Material changes will
        be reflected here.
      </p>
    </LegalLayout>
  )
}
