import { LegalLayout } from '../components/LegalLayout'

const a = { color: '#a78bfa' }

export function Privacy() {
  return (
    <LegalLayout title="Privacy Policy" lastUpdated="September 6, 2026">
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
          <strong>Your content.</strong> The Boards, tasks, descriptions, checklists, Labels, and
          schedules you create in the app, along with account preferences such as theme and your
          default view for each Board.
        </li>
        <li>
          <strong>Browser storage.</strong> We store session tokens to keep you signed in and cache
          Board content, Labels, and preferences in your browser’s local storage so the app can show
          previously synced content offline.
        </li>
        <li>
          <strong>Technical data.</strong> Our infrastructure providers process standard request
          information, such as IP addresses and browser information, for delivery, security, and
          reliability. Cloudflare Web Analytics collects page-view and performance information,
          including page paths, referring sites, browser and device information, and page-load
          timings.
        </li>
      </ul>

      <h2>How we use it</h2>
      <p>
        We use your information solely to provide the service — to authenticate you, store and sync
        your tasks across your devices, deliver account emails, measure website usage and
        performance, and keep the app secure and working. We do <strong>not</strong> sell your data,
        and we do not use it for advertising or profiling.
      </p>

      <h2>Service providers</h2>
      <p>Your data is processed by a small number of providers that run the app:</p>
      <ul>
        <li>
          <strong>Supabase</strong> — database and authentication; stores your account and your
          Board content and preferences.
        </li>
        <li>
          <strong>Google</strong> — authenticates you if you choose “Continue with Google”. We also
          load Google Fonts to display the website’s typefaces. Font requests send Google your IP
          address and browser request information, whether or not you sign in with Google.
        </li>
        <li>
          <strong>Cloudflare</strong> — hosting, content delivery, and Web Analytics to measure
          website usage and performance.
        </li>
        <li>
          <strong>Resend</strong> — delivers authentication emails, such as signup confirmations and
          password resets, and processes the recipient email address and message content.
        </li>
        <li>
          <strong>GitHub</strong> — stores our encrypted database backup files. We encrypt these
          backups before uploading them.
        </li>
      </ul>
      <p>
        We share data with these providers only to operate the service, and otherwise only if
        required by law.
      </p>

      <h2>Security</h2>
      <p>
        Data is transmitted over HTTPS. Database access rules restrict Board content to authorized
        Board members and limit changes according to their role. Account preferences are restricted
        to the account they belong to. No method of storage or transmission is perfectly secure, but
        we take reasonable measures to protect your data.
      </p>

      <h2>Data retention &amp; your choices</h2>
      <p>
        We keep your account and Board content while you use the service, unless you delete them.
        You can edit or delete your tasks within the app. To delete your account, open Settings →
        Danger zone and choose “Delete my account”. This removes your account, private Boards and
        their content, and account settings from the active database. If you need help, email{' '}
        <a href="mailto:jerryholland00@gmail.com" style={a}>
          jerryholland00@gmail.com
        </a>
        .
      </p>
      <p>
        We make encrypted nightly database backups for recovery. Backup files stored on GitHub are
        retained for up to 90 days, so deleted account information and content may remain in those
        backups until they expire. This backup retention period does not describe our providers’
        separate operational logs or analytics records.
      </p>
      <p>
        Signing out clears the app’s offline snapshots in that browser. You can also remove locally
        stored data by clearing this website’s data in your browser settings. Cached content can
        remain when a session expires or a device is offline; deleting your account does not
        immediately erase cached copies on every device.
      </p>
      <p>
        You may also revoke Magic Agenda’s access to your Google account from your{' '}
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
