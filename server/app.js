import express from 'express';
import { getRole, listRoles } from './matrix.js';
import { buildQuestions, computeResult, publicQuestion } from './scoring.js';
import { recommend } from './recommend.js';
import { clearCookie, googleVerifier, parseCookies, readSession, sessionCookie, signSession } from './auth.js';
import { getEmployeeByEmail, getEmployeeById, listAssessable, normEmail, resolveTarget } from './directory.js';

const httpError = (status, message) => Object.assign(new Error(message), { status });

/**
 * Options (all default from env): adminEmails, allowedDomain, googleClientId, devLogin, sessionSecret, verifyGoogle.
 * Identity comes from a signed session cookie created by Google sign-in. The local dev login only exists
 * when explicitly enabled and is always off in production.
 */
export function createApp(db, opts = {}) {
  const production = process.env.NODE_ENV === 'production';
  const googleClientId = opts.googleClientId ?? process.env.GOOGLE_CLIENT_ID ?? '';
  const cfg = {
    adminEmails: new Set(['roshni.parti@rapido.bike', ...(opts.adminEmails ?? process.env.ADMIN_EMAILS ?? '').split(',').map(normEmail)].filter(Boolean)),
    allowedDomain: normEmail(opts.allowedDomain ?? process.env.ALLOWED_EMAIL_DOMAIN ?? 'rapido.bike'),
    googleClientId,
    devLogin: !production && (opts.devLogin ?? !googleClientId),
    secret: opts.sessionSecret ?? process.env.SESSION_SECRET ?? (production ? '' : 'dev-only-secret'),
    secure: production,
  };
  if (!cfg.secret) throw new Error('SESSION_SECRET must be set in production');
  const verifyGoogle = opts.verifyGoogle ?? (googleClientId ? googleVerifier(googleClientId) : null);

  const app = express();
  app.use(express.json({ limit: '1mb' }));

  // Cookies are SameSite=Lax; additionally refuse cross-site browser writes.
  app.use((req, _res, next) => {
    const origin = req.get('origin');
    if (origin && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      let host = '';
      try { host = new URL(origin).host; } catch { /* malformed */ }
      if (host !== req.get('host')) return next(httpError(403, 'Cross-site request blocked'));
    }
    next();
  });

  // ---------- session helpers ----------
  const currentUser = async (req) => {
    const s = readSession(parseCookies(req.headers.cookie).session, cfg.secret);
    if (!s) return null;
    const u = await db.one('SELECT id,name,email,employee_id FROM users WHERE id=$1', [s.uid]);
    return u && { ...u, isAdmin: cfg.adminEmails.has(u.email) };
  };
  const requireUser = async (req) => { const u = await currentUser(req); if (!u) throw httpError(401, 'Please sign in'); return u; };
  const requireAdmin = async (req) => { const u = await requireUser(req); if (!u.isAdmin) throw httpError(403, 'Admins only'); return u; };

  async function startSession(res, emp) {
    const email = normEmail(emp.email);
    await db.run('INSERT INTO users (name,email,employee_id) VALUES ($1,$2,$3) ON CONFLICT (email) DO UPDATE SET name=EXCLUDED.name, employee_id=EXCLUDED.employee_id', [emp.name, email, emp.id]);
    const u = await db.one('SELECT id FROM users WHERE email=$1', [email]);
    res.setHeader('Set-Cookie', sessionCookie(signSession({ uid: u.id }, cfg.secret), cfg));
  }

  // ---------- assessment helpers ----------
  const questionsFor = (a) => buildQuestions(getRole(a.role_id), a.current_level, { quick: !!a.quick }).questions;
  const forEmployee = (qs) => qs.map(publicQuestion);
  const forManager = (qs) => qs.map((q) => ({ ...publicQuestion(q), scenario: null })); // managers never see scenarios

  const view = (a) => ({
    id: a.id, quick: !!a.quick, isTest: !!a.is_test, subjectName: a.subject_name, roleId: a.role_id, roleName: getRole(a.role_id).name,
    currentLevel: a.current_level, targetLevel: a.target_level, selfSubmitted: !!a.self_submitted_at, managerSubmitted: !!a.manager_submitted_at,
    managerName: a.manager_name, createdAt: new Date(a.created_at).toISOString().slice(0, 10),
  });

  const readResponses = async (id, reviewer) =>
    Object.fromEntries((await db.query('SELECT skill_id,rating,skipped,evidence,scenario FROM responses WHERE assessment_id=$1 AND reviewer=$2', [id, reviewer]))
      .map((r) => [r.skill_id, { rating: r.rating, skipped: !!r.skipped, evidence: r.evidence, scenario: r.scenario }]));

  async function saveResponses(id, reviewer, questions, incoming = {}) {
    const valid = new Map(questions.map((q) => [q.id, q]));
    for (const [skillId, r] of Object.entries(incoming)) {
      const q = valid.get(skillId);
      if (!q) continue;
      const skipped = !!r.skipped;
      const rating = skipped || r.rating == null ? null : Number(r.rating);
      if (rating != null && !(Number.isInteger(rating) && rating >= 0 && rating <= q.options.length - 1)) throw httpError(400, `Invalid rating for ${q.title}`);
      let scenario = null; // employee-only, and only counts when the skill itself was rated
      if (reviewer === 'self' && !skipped && r.scenario) {
        if (!q.scenario?.options.some((o) => o.id === r.scenario)) throw httpError(400, `Invalid scenario answer for ${q.title}`);
        scenario = r.scenario;
      }
      await db.run(
        `INSERT INTO responses (assessment_id,reviewer,skill_id,rating,skipped,evidence,scenario) VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (assessment_id,reviewer,skill_id) DO UPDATE SET rating=EXCLUDED.rating, skipped=EXCLUDED.skipped, evidence=EXCLUDED.evidence, scenario=EXCLUDED.scenario`,
        [id, reviewer, skillId, rating, skipped ? 1 : 0, String(r.evidence ?? '').slice(0, 2000), scenario]);
    }
  }
  const answeredCount = async (id, reviewer) => Object.values(await readResponses(id, reviewer)).filter((r) => !r.skipped && r.rating != null).length;

  const loadOwned = async (req) => {
    const user = await requireUser(req);
    const a = await db.one('SELECT * FROM assessments WHERE id=$1 AND user_id=$2', [Number(req.params.id), user.id]);
    if (!a) throw httpError(404, 'Assessment not found');
    return a;
  };
  /** The direct manager (never for test runs) or, for an admin's own test runs, the admin acting as the manager. */
  const loadReviewable = async (req) => {
    const user = await requireUser(req);
    const a = await db.one('SELECT * FROM assessments WHERE id=$1', [Number(req.params.id)]);
    if (!a) throw httpError(404, 'Assessment not found');
    const isManager = !a.is_test && user.employee_id && a.manager_employee_id === user.employee_id && a.user_id !== user.id;
    const isAdminTest = a.is_test && user.isAdmin && a.user_id === user.id;
    if (!isManager && !isAdminTest) throw httpError(403, 'You are not the reviewer for this assessment');
    if (!a.self_submitted_at) throw httpError(409, 'The employee has not submitted their self-assessment yet');
    return a;
  };

  async function resultFor(a) {
    const role = getRole(a.role_id);
    const questions = questionsFor(a);
    const self = await readResponses(a.id, 'self');
    const manager = a.manager_submitted_at ? await readResponses(a.id, 'manager') : null;
    const result = computeResult(questions, { self, manager });
    const evidence = Object.fromEntries(Object.entries(self).filter(([, r]) => r.evidence).map(([k, r]) => [k, r.evidence]));
    return { ...result, quick: !!a.quick, evidence, recommendations: recommend(role, questions, result, a.target_level) };
  }

  // ---------- auth ----------
  app.get('/api/config', (_req, res) => res.json({ googleClientId: cfg.googleClientId, devLogin: cfg.devLogin, allowedDomain: cfg.allowedDomain }));

  app.post('/api/auth/google', async (req, res) => {
    if (!verifyGoogle) throw httpError(503, 'Google sign-in is not configured');
    let g;
    try { g = await verifyGoogle(String(req.body?.credential ?? '')); } catch { throw httpError(401, 'Google could not verify your sign-in. Please try again.'); }
    const email = normEmail(g.email);
    if (!g.emailVerified) throw httpError(403, 'Your Google email is not verified');
    if (!email.endsWith(`@${cfg.allowedDomain}`) || (g.hd && normEmail(g.hd) !== cfg.allowedDomain)) throw httpError(403, `Please sign in with your @${cfg.allowedDomain} work account`);
    const emp = await getEmployeeByEmail(db, email);
    if (!emp) throw httpError(403, "Your email isn't in the active employee list. Please contact People & Culture.");
    await startSession(res, emp);
    res.json({ ok: true });
  });

  app.post('/api/auth/dev', async (req, res) => {
    if (!cfg.devLogin) throw httpError(404, 'Not found');
    const emp = await getEmployeeByEmail(db, req.body?.email);
    if (!emp) throw httpError(403, 'That email is not in the employee directory (run npm run import:employees)');
    await startSession(res, emp);
    res.json({ ok: true });
  });

  app.post('/api/auth/logout', (_req, res) => { res.setHeader('Set-Cookie', clearCookie(cfg)); res.json({ ok: true }); });

  app.get('/api/me', async (req, res) => {
    const user = await requireUser(req);
    const emp = user.employee_id ? await getEmployeeById(db, user.employee_id) : null;
    const waiting = emp ? await db.one('SELECT count(*)::int AS n FROM assessments WHERE manager_employee_id=$1 AND is_test=0 AND self_submitted_at IS NOT NULL AND manager_submitted_at IS NULL', [emp.id]) : { n: 0 };
    res.json({
      user: { id: user.id, name: user.name, email: user.email }, isAdmin: user.isAdmin,
      employee: emp && { id: emp.id, department: emp.parent_department, team: emp.department, title: emp.functional_title || emp.designation, band: emp.band, managerName: emp.manager_name },
      target: resolveTarget(emp), reviewsWaiting: waiting.n,
    });
  });

  // ---------- admin (Roshni): demo flow + take the test as someone else ----------
  app.get('/api/roles', async (req, res) => { await requireAdmin(req); res.json(listRoles()); });
  app.get('/api/admin/employees', async (req, res) => { await requireAdmin(req); res.json(await listAssessable(db)); });

  // ---------- employee ----------
  app.get('/api/assessments', async (req, res) => {
    const user = await requireUser(req);
    res.json((await db.query('SELECT * FROM assessments WHERE user_id=$1 ORDER BY id DESC', [user.id])).map(view));
  });

  app.post('/api/assessments', async (req, res) => {
    const user = await requireUser(req);
    const { roleId, currentLevel, asEmployeeId, quick } = req.body ?? {};
    let row;
    if (asEmployeeId || roleId || quick) {
      // Anything beyond "my own full assessment" is the admin demo flow, and is always recorded as a test.
      if (!user.isAdmin) throw httpError(403, 'Only admins can run the demo flow');
      if (asEmployeeId) {
        const emp = await getEmployeeById(db, String(asEmployeeId));
        const t = resolveTarget(emp);
        if (t.status !== 'ready') throw httpError(422, t.message);
        row = { roleId: t.roleId, currentLevel: t.currentLevel, targetLevel: t.targetLevel, subjectId: emp.id, subjectName: emp.name, managerId: emp.manager_id, managerName: emp.manager_name };
      } else {
        const role = getRole(roleId);
        if (!role) throw httpError(400, 'Unknown role');
        let built;
        try { built = buildQuestions(role, currentLevel); } catch (e) { throw httpError(400, e.message); }
        row = { roleId, currentLevel, targetLevel: built.targetLevel, subjectId: null, subjectName: null, managerId: null, managerName: null };
      }
      row.isTest = 1;
    } else {
      const emp = user.employee_id ? await getEmployeeById(db, user.employee_id) : null;
      const t = resolveTarget(emp);
      if (t.status !== 'ready') throw httpError(422, t.message);
      row = { roleId: t.roleId, currentLevel: t.currentLevel, targetLevel: t.targetLevel, subjectId: null, subjectName: null, managerId: emp.manager_id, managerName: emp.manager_name, isTest: 0 };
    }
    const a = await db.one(
      `INSERT INTO assessments (user_id,role_id,current_level,target_level,quick,is_test,subject_employee_id,subject_name,manager_employee_id,manager_name)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [user.id, row.roleId, row.currentLevel, row.targetLevel, quick ? 1 : 0, row.isTest, row.subjectId, row.subjectName, row.managerId, row.managerName]);
    res.status(201).json(view(a));
  });

  app.get('/api/assessments/:id', async (req, res) => {
    const a = await loadOwned(req);
    res.json({ assessment: view(a), questions: forEmployee(questionsFor(a)), responses: await readResponses(a.id, 'self') });
  });

  app.put('/api/assessments/:id/self', async (req, res) => {
    const a = await loadOwned(req);
    if (a.self_submitted_at) throw httpError(409, 'Self-assessment already submitted');
    await saveResponses(a.id, 'self', questionsFor(a), req.body?.responses);
    if (req.body?.submit) {
      if (!(await answeredCount(a.id, 'self'))) throw httpError(400, 'Answer at least one skill before submitting');
      await db.run('UPDATE assessments SET self_submitted_at=now() WHERE id=$1', [a.id]);
    }
    res.json(view(await db.one('SELECT * FROM assessments WHERE id=$1', [a.id])));
  });

  app.get('/api/assessments/:id/result', async (req, res) => {
    const a = await loadOwned(req);
    if (!a.self_submitted_at) throw httpError(409, 'Submit your self-assessment first');
    res.json({ assessment: view(a), result: await resultFor(a) });
  });

  // ---------- manager (signed in; the direct manager from the master data) ----------
  app.get('/api/reviews', async (req, res) => {
    const user = await requireUser(req);
    const rows = user.employee_id
      ? await db.query(`SELECT a.*, u.name AS owner_name FROM assessments a JOIN users u ON u.id=a.user_id
          WHERE a.manager_employee_id=$1 AND a.is_test=0 AND a.self_submitted_at IS NOT NULL ORDER BY a.manager_submitted_at NULLS FIRST, a.self_submitted_at DESC`, [user.employee_id])
      : [];
    res.json(rows.map((a) => ({ ...view(a), employeeName: a.owner_name })));
  });

  app.get('/api/review/:id', async (req, res) => {
    const a = await loadReviewable(req);
    const owner = await db.one('SELECT name FROM users WHERE id=$1', [a.user_id]);
    const self = await readResponses(a.id, 'self');
    // The employee's ratings are hidden to avoid anchoring; their example notes are shown.
    const employeeEvidence = Object.fromEntries(Object.entries(self).filter(([, r]) => r.evidence).map(([k, r]) => [k, r.evidence]));
    res.json({ assessment: view(a), employeeName: a.subject_name ?? owner.name, questions: forManager(questionsFor(a)), employeeEvidence, responses: await readResponses(a.id, 'manager') });
  });

  app.put('/api/review/:id', async (req, res) => {
    const a = await loadReviewable(req);
    const user = await requireUser(req);
    if (a.manager_submitted_at) throw httpError(409, 'Manager review already submitted');
    await saveResponses(a.id, 'manager', questionsFor(a), req.body?.responses);
    if (req.body?.submit) {
      if (!(await answeredCount(a.id, 'manager'))) throw httpError(400, 'Rate at least one skill before submitting');
      await db.run('UPDATE assessments SET manager_submitted_at=now(), manager_name=$2 WHERE id=$1', [a.id, user.name]);
    }
    res.json(view(await db.one('SELECT * FROM assessments WHERE id=$1', [a.id])));
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    const status = err.status ?? (err.type === 'entity.parse.failed' ? 400 : 500);
    if (status === 500) console.error(err);
    res.status(status).json({ error: status === 500 ? 'Something went wrong' : err.message });
  });
  return app;
}
