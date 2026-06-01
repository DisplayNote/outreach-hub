import { isAuthMockEnabled } from '@/lib/env';
import { Icon } from '@/components/ui';
import MicrosoftSignIn from './microsoft-sign-in';

export const dynamic = 'force-dynamic';

// Capability highlights (not metrics): the login splash is pre-auth, so there
// is no real data to show — keep these as feature copy rather than fabricated
// per-day numbers.
const BRAND_FEATURES: ReadonlyArray<readonly [string, string]> = [
  ['Sequenced', 'email steps'],
  ['Click-to-call', 'with voicemail detection'],
  ['1-click', 'outcome logging'],
];

export default function LoginPage() {
  const mockEnabled = isAuthMockEnabled();

  return (
    <div
      className="login-split"
      style={{
        minHeight: '100vh',
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        background: 'var(--bg-app)',
      }}
    >
      {/* left: sign-in card */}
      <main
        style={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          padding: 'var(--space-9)',
        }}
      >
        <div style={{ width: '100%', maxWidth: 360 }}>
          <div className="row gap-5 center" style={{ marginBottom: 'var(--space-10)' }}>
            <div className="sidebar__logo" style={{ width: 36, height: 36, fontSize: 17 }}>
              O
            </div>
            <div>
              <div style={{ fontSize: 'var(--fs-h3)', fontWeight: 600, letterSpacing: '-0.01em' }}>
                Outreach Hub
              </div>
              <div className="cap tert">by DisplayNote</div>
            </div>
          </div>

          <h1
            style={{
              fontSize: 'var(--fs-h1)',
              fontWeight: 600,
              letterSpacing: '-0.01em',
              marginBottom: 'var(--space-3)',
            }}
          >
            Sign in
          </h1>
          <p className="muted" style={{ marginBottom: 'var(--space-8)' }}>
            Outreach Hub uses your Microsoft 365 account.
          </p>

          <MicrosoftSignIn />

          {mockEnabled ? (
            <>
              <div className="row gap-5 center" style={{ margin: 'var(--space-7) 0' }}>
                <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
                <span className="cap tert">or</span>
                <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
              </div>
              <p className="cap tert" style={{ marginBottom: 'var(--space-5)' }}>
                Local development only — signs in as a seeded test user, no Microsoft required.
              </p>
              <form action="/auth/mock" method="post">
                <button
                  type="submit"
                  className="btn btn--ghost btn--md"
                  style={{ width: '100%', justifyContent: 'center' }}
                >
                  <Icon name="flask" size={15} />
                  Dev sign-in (mock)
                </button>
              </form>
            </>
          ) : null}

          <p
            className="cap tert"
            style={{
              marginTop: 'var(--space-9)',
              textAlign: 'center',
              lineHeight: 'var(--lh-caption)',
            }}
          >
            Protected by Microsoft Entra ID · org-scoped access only.
          </p>
        </div>
      </main>

      {/* right: teal brand panel */}
      <aside
        className="login-brand"
        style={{
          background: 'linear-gradient(150deg, var(--teal-700), var(--teal-900))',
          position: 'relative',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: 'var(--space-12)',
        }}
      >
        {/* dot grid */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            opacity: 0.12,
            backgroundImage: 'radial-gradient(circle at 1px 1px, #fff 1px, transparent 0)',
            backgroundSize: '28px 28px',
          }}
        />
        {/* glows: top-right + bottom-left for depth */}
        <div
          style={{
            position: 'absolute',
            top: '-12%',
            right: '-8%',
            width: 420,
            height: 420,
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(255,255,255,0.18), transparent 70%)',
          }}
        />
        <div
          style={{
            position: 'absolute',
            bottom: '-18%',
            left: '-12%',
            width: 380,
            height: 380,
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(13,129,116,0.55), transparent 70%)',
          }}
        />

        {/* top: wordmark — fills the previously empty top of the panel */}
        <div
          className="row gap-5 center"
          style={{ position: 'relative', color: '#fff' }}
        >
          <div
            className="sidebar__logo"
            style={{ width: 32, height: 32, fontSize: 15, background: 'rgba(255,255,255,0.16)' }}
          >
            O
          </div>
          <div style={{ fontWeight: 600, letterSpacing: '-0.01em' }}>Outreach Hub</div>
        </div>

        {/* bottom: hero */}
        <div style={{ position: 'relative', color: '#fff' }}>
          <div
            style={{
              fontSize: 'var(--fs-display, 34px)',
              fontWeight: 600,
              letterSpacing: '-0.02em',
              lineHeight: 1.2,
              maxWidth: 460,
            }}
          >
            Run a calmer, faster day of outbound.
          </div>
          <p
            style={{
              color: 'rgba(255,255,255,0.8)',
              marginTop: 'var(--space-6)',
              maxWidth: 420,
              lineHeight: 1.55,
            }}
          >
            Sequenced email, click-to-call with auto voicemail detection, and one-click outcome
            logging — all from one mailbox you already own.
          </p>
          <div
            className="row gap-7"
            style={{
              marginTop: 'var(--space-9)',
              paddingTop: 'var(--space-7)',
              borderTop: '1px solid rgba(255,255,255,0.18)',
            }}
          >
            {BRAND_FEATURES.map(([title, label]) => (
              <div key={label}>
                <div style={{ fontSize: 22, fontWeight: 600 }}>{title}</div>
                <div className="cap" style={{ color: 'rgba(255,255,255,0.7)' }}>
                  {label}
                </div>
              </div>
            ))}
          </div>
        </div>
      </aside>
    </div>
  );
}
