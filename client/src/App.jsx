import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api.js';
import { nav, useHash } from './router.js';
import Questionnaire from './Questionnaire.jsx';
import Results from './Results.jsx';

function useLoad(fn, deps) {
  const [state, setState] = useState({ loading: true });
  useEffect(() => {
    let live = true;
    setState({ loading: true });
    fn().then((data) => live && setState({ data }), (error) => live && setState({ error }));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return state;
}
const Status = ({ s }) => (s.loading ? <p className="muted">Loading…</p> : s.error ? <p className="error" role="alert">{s.error.message}</p> : null);

// ---------- sign in ----------
function Login({ config, onDone }) {
  const [err, setErr] = useState('');
  const [f, setF] = useState({ name: '', email: '' });
  const btn = useRef(null);

  useEffect(() => {
    if (!config.googleClientId) return undefined;
    const init = () => {
      window.google.accounts.id.initialize({
        client_id: config.googleClientId, hd: config.allowedDomain,
        callback: async ({ credential }) => { try { await api.googleLogin(credential); onDone(); } catch (e) { setErr(e.message); } },
      });
      window.google.accounts.id.renderButton(btn.current, { theme: 'outline', size: 'large', text: 'signin_with', shape: 'pill', width: 280 });
    };
    if (window.google?.accounts?.id) { init(); return undefined; }
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client'; s.async = true; s.onload = init;
    s.onerror = () => setErr('Could not load Google sign-in. Check your connection and try again.');
    document.head.appendChild(s);
    return undefined;
  }, [config.googleClientId, config.allowedDomain, onDone]);

  return (
    <div className="card narrow">
      <h1>Level readiness</h1>
      <p className="muted">See how ready you are for your next level and what to work on. Sign in with your Rapido work account; your function, level and manager come from the employee master.</p>
      {config.googleClientId && <div ref={btn} className="gbtn" />}
      {config.devLogin && (
        <form onSubmit={async (e) => { e.preventDefault(); try { await api.devLogin(f); onDone(); } catch (x) { setErr(x.message); } }} className="devlogin">
          <p className="muted small">{__DEMO__ ? 'Demo sign-in (nothing leaves your browser).' : 'Local development sign-in.'}</p>
          {__DEMO__ && <label>Name<input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>}
          <label>Work email<input required type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder={`you@${config.allowedDomain || 'rapido.bike'}`} /></label>
          <button className="btn primary">Continue</button>
        </form>
      )}
      {!config.googleClientId && !config.devLogin && <p className="error">Sign-in isn't configured yet. Please contact the tool owner.</p>}
      {err && <p className="error" role="alert">{err}</p>}
    </div>
  );
}

// ---------- home ----------
function Profile({ me }) {
  const e = me.employee;
  if (!e) return null;
  return (
    <section className="card profile">
      <h2>Your profile</h2>
      <dl>
        <div><dt>Function</dt><dd>{e.department}{e.team && e.team !== e.department ? ` · ${e.team}` : ''}</dd></div>
        <div><dt>Title</dt><dd>{e.title || '–'}{e.band ? ` (${e.band})` : ''}</dd></div>
        <div><dt>Manager</dt><dd>{e.managerName || '–'}</dd></div>
      </dl>
      <p className="muted small">From the Rapido employee master. If anything here is wrong, ask People &amp; Culture to correct it.</p>
    </section>
  );
}

function MyAssessment({ me, onError }) {
  const t = me.target;
  const start = async () => { try { nav(`/assess/${(await api.create()).id}`); } catch (e) { onError(e.message); } };
  if (t.status === 'ready') {
    return (
      <section className="card cta">
        <div>
          <h2>Ready for {t.targetLevel}?</h2>
          <p className="muted small">{t.roleName} · you are at <strong>{t.currentLevel}</strong>. You'll rate yourself on the skills expected at {t.targetLevel}, then your manager reviews the same skills. About 20–30 minutes.</p>
        </div>
        <button className="btn primary" onClick={start}>Start my assessment</button>
      </section>
    );
  }
  return <section className="card notice"><strong>{{ 'no-matrix': 'Not available yet', 'unsupported-team': 'Not available yet', 'no-level': 'We need your level', 'top-level': 'Top of your track' }[t.status] ?? 'Not available'}</strong><p>{t.message}</p></section>;
}

function AdminDemo({ onError }) {
  const roles = useLoad(api.roles, []);
  const people = useLoad(api.adminEmployees, []);
  const [roleId, setRoleId] = useState('');
  const [level, setLevel] = useState('');
  const [q, setQ] = useState('');
  const [pick, setPick] = useState('');
  const role = roles.data?.find((r) => r.id === roleId);
  const matches = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (people.data ?? []).filter((p) => !s || `${p.name} ${p.email} ${p.roleName}`.toLowerCase().includes(s)).slice(0, 300);
  }, [people.data, q]);
  const go = async (body) => { try { nav(`/assess/${(await api.create(body)).id}`); } catch (e) { onError(e.message); } };

  return (
    <>
      <section className="card cta">
        <div>
          <h2>Quick demo <span className="chip admin-chip">Admin</span></h2>
          <p className="muted small">About 5 minutes: 8 key skills with real-world scenarios and a readiness score at the end. Uses the role and level you pick in the manual picker below, or a sample Developer profile.</p>
        </div>
        <button className="btn primary" onClick={() => go(roleId && level ? { roleId, currentLevel: level, quick: true } : { roleId: 'developer', currentLevel: 'Product Engineer', quick: true })}>Try quick demo</button>
      </section>

      {!__DEMO__ && (
        <section className="card">
          <h2>Take the test as another employee <span className="chip admin-chip">Admin</span></h2>
          <p className="muted small">Runs the real assessment for their role and level, with their manager. It is saved as a test under your account, so it never shows up in their history or their manager's queue.</p>
          <Status s={people} />
          {people.data && (
            <div className="form-row asrow">
              <label>Find an employee<input value={q} onChange={(e) => { setQ(e.target.value); setPick(''); }} placeholder="Search by name, email or role" /></label>
              <label>Employee ({matches.length})
                <select value={pick} onChange={(e) => setPick(e.target.value)}>
                  <option value="">Select…</option>
                  {matches.map((p) => <option key={p.id} value={p.id}>{p.name}: {p.roleName}, {p.currentLevel} → {p.targetLevel} (mgr {p.managerName || '–'})</option>)}
                </select>
              </label>
              <button className="btn primary" disabled={!pick} onClick={() => go({ asEmployeeId: pick })}>Take the test</button>
            </div>
          )}
        </section>
      )}

      <section className="card">
        <h2>Manual role and level <span className="chip admin-chip">Admin</span></h2>
        <Status s={roles} />
        {roles.data && (
          <div className="form-row">
            <label>Role
              <select value={roleId} onChange={(e) => { setRoleId(e.target.value); setLevel(''); }}>
                <option value="">Select…</option>
                {roles.data.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </label>
            <label>Current level
              <select value={level} onChange={(e) => setLevel(e.target.value)} disabled={!role}>
                <option value="">Select…</option>
                {role?.levels.map((l) => <option key={l.name} value={l.name} disabled={!l.hasNext}>{l.name}{!l.hasNext ? ' · top of track' : ''}</option>)}
              </select>
            </label>
            <button className="btn primary" disabled={!roleId || !level} onClick={() => go({ roleId, currentLevel: level })}>Begin full assessment</button>
          </div>
        )}
      </section>
    </>
  );
}

function Home({ me }) {
  const list = useLoad(api.list, []);
  const [err, setErr] = useState('');
  return (
    <>
      {err && <p className="error" role="alert">{err}</p>}
      {me.reviewsWaiting > 0 && (
        <section className="card cta">
          <div><h2>{me.reviewsWaiting} review{me.reviewsWaiting > 1 ? 's' : ''} waiting for you</h2><p className="muted small">People in your team have submitted a self-assessment and are waiting for your ratings.</p></div>
          <button className="btn primary" onClick={() => nav('/reviews')}>Open team reviews</button>
        </section>
      )}
      {!__DEMO__ && <Profile me={me} />}
      {!__DEMO__ && !(me.isAdmin && me.target.status !== 'ready') && <MyAssessment me={me} onError={setErr} />}
      {me.isAdmin && <AdminDemo onError={setErr} />}

      <section className="card">
        <h2>Your assessments</h2>
        <Status s={list} />
        {list.data?.length === 0 && <p className="muted">None yet.</p>}
        {list.data?.map((a) => (
          <div key={a.id} className="list-row">
            <div>
              <strong>{a.roleName}</strong>: {a.currentLevel} → {a.targetLevel}
              {a.quick && <span className="chip quick-chip">Quick check</span>}
              {a.isTest && <span className="chip quick-chip">Test{a.subjectName ? ` as ${a.subjectName}` : ''}</span>}
              <div className="muted small">{a.createdAt} · {a.selfSubmitted ? (a.managerSubmitted ? 'Manager reviewed' : 'Awaiting manager review') : 'In progress'}</div>
            </div>
            <button className="btn" onClick={() => nav(a.selfSubmitted ? `/result/${a.id}` : `/assess/${a.id}`)}>{a.selfSubmitted ? 'View results' : 'Continue'}</button>
          </div>
        ))}
      </section>
    </>
  );
}

// ---------- assessment, results ----------
function Assess({ id }) {
  const s = useLoad(() => api.get(id), [id]);
  if (s.loading || s.error) return <Status s={s} />;
  const { assessment, questions, responses } = s.data;
  if (assessment.selfSubmitted) { nav(`/result/${id}`); return null; }
  return (
    <Questionnaire
      key={id} questions={questions} initial={responses} mode="self" quick={assessment.quick}
      headerExtra={<><a href="#/" className="small">← Back</a><h1>{assessment.roleName}: ready for {assessment.targetLevel}?</h1>{assessment.isTest && assessment.subjectName && <p className="notice small">Test run as <strong>{assessment.subjectName}</strong>.</p>}{assessment.quick && <p className="notice"><strong>Quick check:</strong> {questions.length} key skills, about 5 minutes. The full assessment covers every skill and gives a more reliable score.</p>}<p className="muted">Rate yourself against what <strong>{assessment.targetLevel}</strong> expects. Be honest: your manager will review the same skills and the gap analysis is only useful if it's accurate.</p></>}
      onSave={async (answers, submit) => { await api.saveSelf(id, answers, submit); if (submit) nav(`/result/${id}`); }}
    />
  );
}

function ResultPage({ id }) {
  const s = useLoad(() => api.result(id), [id]);
  if (s.loading || s.error) return <Status s={s} />;
  const a = s.data.assessment;
  return (
    <>
      <a href="#/" className="small no-print">← All assessments</a>
      <Results assessment={a} result={s.data.result} onOpenReview={() => nav(`/review/${a.id}`)}
        onStartFull={async () => { const b = await api.create(a.isTest ? { roleId: a.roleId, currentLevel: a.currentLevel } : {}); nav(`/assess/${b.id}`); }} />
    </>
  );
}

// ---------- manager ----------
function Reviews() {
  const s = useLoad(api.reviews, []);
  return (
    <section className="card">
      <a href="#/" className="small">← Back</a>
      <h1>Team reviews</h1>
      <p className="muted small">Self-assessments from people who report to you, according to the Rapido employee master.</p>
      <Status s={s} />
      {s.data?.length === 0 && <p className="muted">Nothing here yet. When someone on your team submits their self-assessment it will appear here.</p>}
      {s.data?.map((a) => (
        <div key={a.id} className="list-row">
          <div><strong>{a.employeeName}</strong>: {a.roleName}, {a.currentLevel} → {a.targetLevel}<div className="muted small">{a.managerSubmitted ? 'You have reviewed this' : 'Waiting for your review'}</div></div>
          {!a.managerSubmitted && <button className="btn primary" onClick={() => nav(`/review/${a.id}`)}>Review</button>}
        </div>
      ))}
    </section>
  );
}

function Review({ id }) {
  const s = useLoad(() => api.review(id), [id]);
  const [submitted, setSubmitted] = useState(false);
  if (s.loading || s.error) return <Status s={s} />;
  const { assessment, questions, employeeName, employeeEvidence, responses } = s.data;
  if (assessment.managerSubmitted || submitted) return <div className="card narrow"><h1>Thank you</h1><p>Your review of {employeeName} has been submitted. They can now see their combined results.</p><a className="btn primary" href={assessment.isTest ? `#/result/${id}` : '#/reviews'}>{assessment.isTest ? 'See combined results' : 'Back to team reviews'}</a></div>;
  return (
    <Questionnaire
      key={id} questions={questions} initial={responses} mode="manager" quick={assessment.quick} evidenceFromEmployee={employeeEvidence}
      headerExtra={<><h1>Manager review: {employeeName}</h1><p className="muted">{assessment.roleName}, assessing readiness for <strong>{assessment.targetLevel}</strong> (currently {assessment.currentLevel}). Rate the same skills based on what you have observed. The employee's own ratings are hidden to avoid anchoring; their examples are shown.</p></>}
      onSave={async (answers, submit) => { await api.saveReview(id, answers, submit); if (submit) setSubmitted(true); }}
    />
  );
}

// ---------- shell ----------
export default function App() {
  const hash = useHash();
  const [state, setState] = useState({ loading: true });

  const load = async () => {
    try { setState({ me: await api.me() }); }
    catch (e) {
      if (e.status !== 401) return setState({ error: e });
      try { setState({ config: await api.config() }); } catch (x) { setState({ error: x }); }
    }
  };
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const assess = hash.match(/^\/assess\/(\d+)/);
  const result = hash.match(/^\/result\/(\d+)/);
  const review = hash.match(/^\/review\/(\d+)/);
  let body;
  if (state.loading) body = <p className="muted">Loading…</p>;
  else if (state.error) body = <p className="error" role="alert">{state.error.message}</p>;
  else if (state.config) body = <Login config={state.config} onDone={() => { setState({ loading: true }); nav('/'); load(); }} />;
  else if (assess) body = <Assess id={assess[1]} />;
  else if (result) body = <ResultPage id={result[1]} />;
  else if (review) body = <Review id={review[1]} />;
  else if (hash === '/reviews') body = <Reviews />;
  else body = <Home me={state.me} />;

  return (
    <>
      <header className="topbar no-print">
        <a href="#/" className="brand">Level Readiness</a>
        {state.me && (
          <span className="topnav">
            <a href="#/reviews">Team reviews{state.me.reviewsWaiting > 0 ? ` (${state.me.reviewsWaiting})` : ''}</a>
            {state.me.user.name} · <button className="link" onClick={async () => { await api.logout(); nav('/'); setState({ loading: true }); load(); }}>Sign out</button>
          </span>
        )}
      </header>
      {__DEMO__ && <p className="demo-banner no-print">Demo: everything stays in this browser. After you submit your self-assessment, use "Review as manager (test)" to play the manager in the same window.</p>}
      <main>{body}</main>
    </>
  );
}
