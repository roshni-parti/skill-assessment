import { useMemo, useState } from 'react';

// Shared by the employee self-assessment and the manager review.
// props.responses: initial saved answers; props.onSave(responses, submit) persists them.
export default function Questionnaire({ questions, initial, onSave, mode, quick = false, evidenceFromEmployee = {}, headerExtra }) {
  const areas = useMemo(() => {
    if (quick) return [['Quick check', questions]]; // one short page instead of one step per area
    const map = new Map();
    for (const q of questions) (map.get(q.area) ?? map.set(q.area, []).get(q.area)).push(q);
    return [...map.entries()];
  }, [questions, quick]);
  const [answers, setAnswers] = useState(initial ?? {});
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirming, setConfirming] = useState(false);
  const isManager = mode === 'manager';

  const set = (id, patch) => setAnswers((a) => ({ ...a, [id]: { ...a[id], ...patch } }));
  const answered = (q) => answers[q.id]?.skipped || answers[q.id]?.rating != null;
  const done = questions.filter(answered).length;
  const [areaName, areaQs] = areas[step];
  const last = step === areas.length - 1;

  async function persist(submit) {
    setBusy(true); setError('');
    try { await onSave(answers, submit); return true; }
    catch (e) { setError(e.message); return false; }
    finally { setBusy(false); }
  }
  const go = async (next) => { if (await persist(false)) { setStep(next); window.scrollTo({ top: 0 }); } };

  return (
    <div className="wizard">
      {headerExtra}
      <div className="progress" role="progressbar" aria-valuenow={done} aria-valuemax={questions.length}>
        <div style={{ width: `${(done / questions.length) * 100}%` }} />
      </div>
      <p className="muted small">{done} of {questions.length} skills answered · progress is saved when you move between sections</p>

      {areas.length > 1 && <nav className="steps">
        {areas.map(([name, qs], i) => (
          <button key={name} className={`step ${i === step ? 'on' : ''} ${qs.every(answered) ? 'done' : ''}`} onClick={() => go(i)} disabled={busy}>
            {name}
          </button>
        ))}
      </nav>}

      {!quick && <h2>{areaName}</h2>}
      {areaQs.map((q) => {
        const a = answers[q.id] ?? {};
        return (
          <fieldset key={q.id} className={`skill ${a.skipped ? 'skipped' : ''}`}>
            <legend className="skill-title">{q.title}</legend>
            <div className="chips">
              <span className={`chip gate ${q.gate?.replace(/\s/g, '').toLowerCase() ?? 'none'}`}>{q.gate ?? 'Expected'}</span>
              <span className="chip">Target: {q.targetProficiency}</span>
              {q.stretch && <span className="chip stretch">Step up from current level</span>}
            </div>
            {q.details.length > 0 && <p className="muted small details">{q.details.join(' · ')}</p>}

            {isManager && evidenceFromEmployee[q.id] && (
              <blockquote className="employee-note"><strong>Employee's example:</strong> {evidenceFromEmployee[q.id]}</blockquote>
            )}

            <div className="options" aria-disabled={!!a.skipped}>
              {q.options.map((o) => (
                <label key={o.value} className={`option ${a.rating === o.value && !a.skipped ? 'picked' : ''}`}>
                  <input type="radio" name={q.id} disabled={!!a.skipped} checked={a.rating === o.value && !a.skipped} onChange={() => set(q.id, { rating: o.value, skipped: false })} />
                  <span>
                    <strong>{o.label}</strong>
                    {o.value === q.targetStep && <em className="target-tag"> · expected at next level</em>}
                    <span className="opt-text">{o.text.split('\n').map((l, i) => <span key={i}>{l.replace(/^[-•]\s*/, '')}</span>)}</span>
                    {o.generic && o.value > 0 && <span className="muted small">(generic wording: no skill-specific description in the matrix)</span>}
                  </span>
                </label>
              ))}
            </div>

            {!isManager && q.scenario && !a.skipped && (
              <div className="scenario">
                <p className="small"><strong>Scenario.</strong> {q.scenario.situation} <span className="muted">What would you most likely do? (optional; it adjusts your score)</span></p>
                <div className="options">
                  {q.scenario.options.map((o) => (
                    <label key={o.id} className={`option ${a.scenario === o.id ? 'picked' : ''}`}>
                      <input type="radio" name={`${q.id}-scenario`} checked={a.scenario === o.id} onChange={() => set(q.id, { scenario: o.id })} />
                      <span className="opt-text">{o.text}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {!quick && !a.skipped && a.rating > 0 && (
              <label className="evidence">
                <span className="small">{isManager ? 'Your observation (optional)' : q.prompt}</span>
                <textarea rows={2} maxLength={2000} value={a.evidence ?? ''} onChange={(e) => set(q.id, { evidence: e.target.value })}
                  placeholder={isManager ? 'What have you seen that supports this rating?' : 'A project, outcome or situation…'} />
              </label>
            )}
            <label className="skip">
              <input type="checkbox" checked={!!a.skipped} onChange={(e) => set(q.id, { skipped: e.target.checked, rating: e.target.checked ? null : a.rating })} />
              {isManager ? "I can't assess this" : "Skip: I can't assess this yet"}
            </label>
          </fieldset>
        );
      })}

      {confirming && (
        <div className="notice" role="alertdialog">
          {questions.length - done} skill(s) are unanswered and will be left out of the score.
          <div className="linkrow">
            <button className="btn small-btn primary" onClick={() => { setConfirming(false); persist(true); }}>Submit anyway</button>
            <button className="btn small-btn" onClick={() => setConfirming(false)}>Keep answering</button>
          </div>
        </div>
      )}
      {error && <p className="error" role="alert">{error}</p>}
      <div className="actions">
        <button className="btn ghost" disabled={busy || step === 0} onClick={() => go(step - 1)}>Back</button>
        {!last && <button className="btn" disabled={busy} onClick={() => go(step + 1)}>Save & next</button>}
        {last && (
          <button className="btn primary" disabled={busy || done === 0}
            onClick={() => (questions.length - done ? setConfirming(true) : persist(true))}>
            {isManager ? 'Submit review' : 'Submit self-assessment'}
          </button>
        )}
      </div>
    </div>
  );
}
