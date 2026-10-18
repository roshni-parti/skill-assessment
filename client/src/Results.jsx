const bandClass = (b) => b.toLowerCase().replace(/[^a-z]+/g, '-');

function Ring({ score, band }) {
  const r = 52, c = 2 * Math.PI * r;
  return (
    <div className={`ring ${bandClass(band)}`}>
      <svg viewBox="0 0 120 120" role="img" aria-label={`Readiness score ${score} out of 100`}>
        <circle cx="60" cy="60" r={r} className="track" />
        <circle cx="60" cy="60" r={r} className="value" strokeDasharray={`${(score / 100) * c} ${c}`} transform="rotate(-90 60 60)" />
      </svg>
      <div className="ring-text"><strong>{score}</strong><span>/ 100</span></div>
    </div>
  );
}

const cell = (v, max) => (v == null ? '–' : `${Math.round(v * 10) / 10} / ${max}`);

export default function Results({ assessment, result, onOpenReview, onStartFull }) {
  const hasManager = result.basis.includes('manager');

  return (
    <div className="results">
      <header className="hero card">
        <Ring score={result.score} band={result.band} />
        <div>
          <p className="muted small">{assessment.roleName}: {assessment.currentLevel} → {assessment.targetLevel}</p>
          <h1>{result.band}</h1>
          <p>Readiness for <strong>{assessment.targetLevel}</strong>, based on {result.basis}. {result.coverage.rated} of {result.coverage.total} skills rated ({result.coverage.weightPct}% of the weight).</p>
          {assessment.isTest && <p className="notice small"><strong>Test run{assessment.subjectName ? ` as ${assessment.subjectName}` : ''}.</strong> Saved separately: it does not appear in that person's history or their manager's queue.</p>}
          {!hasManager && (
            <div className="notice">
              <strong>Provisional:</strong> {assessment.isTest
                ? 'no manager review yet. Play the manager to see the combined score.'
                : `${assessment.managerName ? assessment.managerName + ' (your manager)' : 'Your manager'} hasn't reviewed yet. They will see this in their Team reviews list, and your score updates once they submit.`}
              {assessment.isTest && <div className="linkrow"><button className="btn small-btn" onClick={onOpenReview}>Review as manager (test)</button></div>}
            </div>
          )}
          {hasManager && <p className="muted small">Reviewed by {assessment.managerName}. Score blends 40% self and 60% manager per skill.</p>}
        </div>
      </header>

      {result.quick && (
        <section className="card notice">
          <strong>Quick check:</strong> this score is based on {result.coverage.total} key skills, so treat it as indicative. The full assessment covers every skill for {assessment.targetLevel} and gives a more reliable picture.
          <div className="linkrow"><button className="btn small-btn primary" onClick={onStartFull}>Take the full assessment</button></div>
        </section>
      )}

      {result.blockers.length > 0 && (
        <section className="card blockers">
          <h2>Must-have gaps ({result.blockers.length})</h2>
          <p className="muted small">Skills marked Must Have at {assessment.targetLevel} where you are currently below the expectation. These matter most for promotion readiness.</p>
          <ul>{result.blockers.map((b) => <li key={b.id}><strong>{b.title}</strong>: expected {b.targetProficiency}</li>)}</ul>
        </section>
      )}

      <section className="card">
        <h2>By area</h2>
        {result.areas.map((a) => (
          <div key={a.area} className="bar-row">
            <span>{a.area}</span>
            <div className="bar"><div style={{ width: `${a.score ?? 0}%` }} /></div>
            <span className="bar-val">{a.score ?? '–'}{a.score != null && '%'}</span>
          </div>
        ))}
      </section>

      <section className="card">
        <h2>Recommendations</h2>
        {result.recommendations.length === 0 && <p>No gaps found against {assessment.targetLevel}. Well done.</p>}
        {result.recommendations.map((r, i) => (
          <article key={r.skillId} className="rec">
            <h3>{i + 1}. {r.title} <span className="chip">{r.area}</span> {r.gate && <span className={`chip gate ${r.gate.replace(/\s/g, '').toLowerCase()}`}>{r.gate}</span>}</h3>
            <p className="small"><strong>Now:</strong> {r.current} → <strong>Needed:</strong> {r.target}</p>
            {r.toDemonstrate.length > 0 && (
              <>
                <p className="small"><strong>What {assessment.targetLevel} looks like:</strong></p>
                <ul className="small">{r.toDemonstrate.map((t, j) => <li key={j}>{t}</li>)}</ul>
              </>
            )}
            <ul className="actions-list">{r.actions.map((a, j) => <li key={j}><span className="chip action">{a.type}</span> {a.text}</li>)}</ul>
          </article>
        ))}
        {result.gaps.length > result.recommendations.length && <p className="muted small">Showing the top {result.recommendations.length} of {result.gaps.length} gaps, ranked by size and gate importance.</p>}
      </section>

      {result.perceptionGaps.length > 0 && (
        <section className="card">
          <h2>Where self and manager views differ</h2>
          <ul>{result.perceptionGaps.map((p) => <li key={p.id}><strong>{p.title}</strong>: {p.perception === 'self-higher' ? 'you rated yourself higher than your manager did' : 'your manager rated you higher than you rated yourself'}</li>)}</ul>
        </section>
      )}

      {result.scenarioFlags?.length > 0 && (
        <section className="card">
          <h2>Where your scenario answers differ from your ratings</h2>
          <p className="muted small">You rated yourself at least two steps away from what your scenario answer suggests. Worth a closer look.</p>
          <ul>{result.scenarioFlags.map((p) => <li key={p.id}><strong>{p.title}</strong>: {p.scenarioFlag === 'below-rating' ? 'your scenario answer was well below how you rated yourself' : 'your scenario answer was well above how you rated yourself'}</li>)}</ul>
        </section>
      )}

      <section className="card">
        <h2>All skills</h2>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Skill</th><th>Gate</th><th>Target</th><th>You</th>{result.scenarioCount > 0 && <th>Scenario</th>}{hasManager && <th>Manager</th>}<th>Status</th></tr></thead>
            <tbody>
              {result.skills.map((s) => (
                <tr key={s.id}>
                  <td>{s.title}<div className="muted small">{s.area}</div></td>
                  <td>{s.gate ?? '–'}</td>
                  <td>{s.targetProficiency}</td>
                  <td>{cell(s.self, s.targetStep)}</td>
                  {result.scenarioCount > 0 && <td>{cell(s.scenario, s.targetStep)}</td>}
                  {hasManager && <td>{cell(s.manager, s.targetStep)}</td>}
                  <td>{s.effective == null ? <span className="muted">Not rated</span> : s.gap > 0.001 ? <span className="status gap">Gap {Math.round(s.gap * 10) / 10}</span> : <span className="status ok">Meets</span>}{s.perception && <span className="status diff"> ≠</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {!__DEMO__ && <button className="btn ghost no-print" onClick={() => window.print()}>Print / save as PDF</button>}
    </div>
  );
}
