import './styles.css';

const surfaces = [
  'Claimant PWA',
  'Insurer dashboard',
  'Reviewer queue',
  'Admin console'
];

export function App() {
  return (
    <main className="app-shell">
      <section className="intro-panel" aria-labelledby="app-title">
        <p className="eyebrow">Phase 1 pilot scaffold</p>
        <h1 id="app-title">Glass Claim Assessment</h1>
        <p>
          Consent-gated windscreen claim assessment workspace for the API,
          dashboard, admin, and claimant PWA surfaces.
        </p>
      </section>

      <section className="surface-grid" aria-label="Application surfaces">
        {surfaces.map((surface) => (
          <article className="surface-card" key={surface}>
            <span>{surface}</span>
          </article>
        ))}
      </section>
    </main>
  );
}
