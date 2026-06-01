// Instant navigation feedback. The root layout (sidebar + topbar) persists
// across soft navigations; this skeleton fills the content area while the
// server renders the next page (auth check + data query), so clicking a nav
// item feels immediate instead of frozen. Next.js uses it as the Suspense
// fallback for any route segment that lacks its own loading.tsx.
export default function Loading() {
  return (
    <div className="content__inner" aria-busy="true" aria-live="polite">
      <div className="page-head">
        <div>
          <div className="skel" style={{ width: 180, height: 28, borderRadius: 'var(--radius-sm)' }} />
          <div
            className="skel"
            style={{ width: 280, height: 14, marginTop: 'var(--space-4)', borderRadius: 'var(--radius-sm)' }}
          />
        </div>
        <div className="skel" style={{ width: 132, height: 36, borderRadius: 'var(--radius-md)' }} />
      </div>

      <div className="card">
        <div className="card__body" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="skel" style={{ height: 44, borderRadius: 'var(--radius-md)' }} />
          ))}
        </div>
      </div>
    </div>
  );
}
