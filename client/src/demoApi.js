// Static-demo replacement for api.js: same interface, everything runs in the browser.
// The demo user is always an "admin": manual role/level picker and the quick check, with Review-as-manager on their own run.
import raw from '../../data/matrix.json';
import scenarios from '../../data/scenarios.json';
import { applyScenarios, normaliseRole } from '../../server/normalise.js';
import { buildQuestions, computeResult, publicQuestion } from '../../server/scoring.js';
import { recommend } from '../../server/recommend.js';

const roles = raw.roles.map(normaliseRole);
applyScenarios(roles, scenarios);
const byId = Object.fromEntries(roles.map((r) => [r.id, r]));
const KEY = 'readiness.demo.v2';

let mem = { seq: 0, assessments: [], responses: {}, user: null };
try { const s = localStorage.getItem(KEY); if (s) mem = JSON.parse(s); } catch { /* storage unavailable: stay in memory */ }
const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(mem)); } catch { /* ignore */ } };

const fail = (m, status) => Promise.reject(Object.assign(new Error(m), { status }));
const resp = (id, who) => (mem.responses[`${id}|${who}`] ??= {});
const questionsOf = (a) => buildQuestions(byId[a.roleId], a.currentLevel, { quick: !!a.quick }).questions;
const forEmployee = (qs) => qs.map(publicQuestion);
const forManager = (qs) => qs.map((q) => ({ ...publicQuestion(q), scenario: null }));
const view = (a) => ({ ...a, quick: !!a.quick, isTest: true, subjectName: null, roleName: byId[a.roleId].name, selfSubmitted: !!a.selfSubmittedAt, managerSubmitted: !!a.managerSubmittedAt });
const owned = (id) => mem.assessments.find((a) => a.id === Number(id));
const clone = (x) => JSON.parse(JSON.stringify(x));
const answeredCount = (a, who) => Object.values(resp(a.id, who)).filter((r) => !r.skipped && r.rating != null).length;

function save(a, who, questions, incoming = {}) {
  const store = resp(a.id, who);
  const valid = new Map(questions.map((q) => [q.id, q]));
  for (const [id, r] of Object.entries(incoming)) {
    const q = valid.get(id);
    if (!q) continue;
    const scenario = who === 'self' && !r.skipped && q.scenario?.options.some((o) => o.id === r.scenario) ? r.scenario : null;
    store[id] = { rating: r.skipped || r.rating == null ? null : Number(r.rating), skipped: !!r.skipped, evidence: String(r.evidence ?? '').slice(0, 2000), scenario };
  }
  persist();
}

export const api = {
  config: async () => ({ googleClientId: '', devLogin: true, allowedDomain: 'rapido.bike' }),
  devLogin: async ({ name, email }) => { if (!String(name ?? '').trim() || !String(email ?? '').includes('@')) throw new Error('Name and a valid email are required'); mem.user = { id: 1, name: name.trim(), email }; persist(); return { ok: true }; },
  googleLogin: async () => ({ ok: true }),
  logout: async () => { mem.user = null; persist(); return { ok: true }; },
  me: async () => (mem.user
    ? { user: mem.user, isAdmin: true, employee: null, target: { status: 'no-matrix', message: '' }, reviewsWaiting: 0 }
    : fail('Please sign in', 401)),
  roles: async () => roles.map((r) => ({ id: r.id, name: r.name, levels: r.levels.map((l, i) => ({ name: l.name, jobLevel: l.jobLevel, hasNext: i < r.levels.length - 1 })) })),
  adminEmployees: async () => [],
  list: async () => mem.assessments.map(view).reverse(),
  create: async ({ roleId, currentLevel, quick } = {}) => {
    const role = byId[roleId];
    if (!role) throw new Error('Unknown role');
    const { targetLevel } = buildQuestions(role, currentLevel);
    const a = { id: ++mem.seq, roleId, currentLevel, targetLevel, quick: !!quick, createdAt: new Date().toISOString().slice(0, 10), managerName: null };
    mem.assessments.push(a); persist();
    return view(a);
  },
  get: async (id) => { const a = owned(id); if (!a) return fail('Assessment not found'); return { assessment: view(a), questions: forEmployee(questionsOf(a)), responses: clone(resp(a.id, 'self')) }; },
  saveSelf: async (id, responses, submit) => {
    const a = owned(id);
    if (!a) return fail('Assessment not found');
    save(a, 'self', questionsOf(a), responses);
    if (submit) { if (!answeredCount(a, 'self')) return fail('Answer at least one skill before submitting'); a.selfSubmittedAt = Date.now(); persist(); }
    return view(a);
  },
  result: async (id) => {
    const a = owned(id);
    if (!a?.selfSubmittedAt) return fail('Submit your self-assessment first');
    const questions = questionsOf(a);
    const result = computeResult(questions, { self: resp(a.id, 'self'), manager: a.managerSubmittedAt ? resp(a.id, 'manager') : null });
    return clone({ assessment: view(a), result: { ...result, quick: !!a.quick, recommendations: recommend(byId[a.roleId], questions, result, a.targetLevel) } });
  },
  reviews: async () => [],
  review: async (id) => {
    const a = owned(id);
    if (!a?.selfSubmittedAt) return fail('The employee has not submitted their self-assessment yet');
    const ev = Object.fromEntries(Object.entries(resp(a.id, 'self')).filter(([, r]) => r.evidence).map(([k, r]) => [k, r.evidence]));
    return { assessment: view(a), employeeName: mem.user?.name ?? 'Employee', questions: forManager(questionsOf(a)), employeeEvidence: ev, responses: clone(resp(a.id, 'manager')) };
  },
  saveReview: async (id, responses, submit) => {
    const a = owned(id);
    if (!a) return fail('Assessment not found');
    if (a.managerSubmittedAt) return fail('Manager review already submitted');
    save(a, 'manager', questionsOf(a), responses);
    a.managerName = mem.user?.name ?? 'Manager';
    if (submit) { if (!answeredCount(a, 'manager')) return fail('Rate at least one skill before submitting'); a.managerSubmittedAt = Date.now(); }
    persist();
    return view(a);
  },
};
