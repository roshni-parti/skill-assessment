import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openDb } from './db.js';
import { createApp } from './app.js';
import { getRole, loadMatrix } from './matrix.js';
import { buildQuestions, computeResult } from './scoring.js';
import { resolveTarget, upsertEmployees } from './directory.js';

const q = (id, targetStep, gate) => ({ id, area: 'A', title: id, gate, targetStep, targetProficiency: 'X', stretch: true, options: [] });

// ---------- scoring ----------
test('score: weighted by gate, capped at target', () => {
  const qs = [q('m', 2, 'Must Have'), q('g', 2, 'Good to Have')];
  const r = computeResult(qs, { self: { m: { rating: 2 }, g: { rating: 0 } } });
  assert.equal(r.score, 75); // must (w3) = 100%, good (w1) = 0%
  assert.equal(r.blockers.length, 0);
  assert.equal(computeResult(qs, { self: { m: { rating: 4 }, g: { rating: 4 } } }).score, 100);
});

test('must-have gap is a blocker and prevents "Ready"', () => {
  const qs = [q('m', 3, 'Must Have'), q('s', 1, 'Should Have'), q('s2', 1, 'Should Have'), q('s3', 1, 'Should Have')];
  const r = computeResult(qs, { self: { m: { rating: 2 }, s: { rating: 1 }, s2: { rating: 1 }, s3: { rating: 1 } } });
  assert.ok(r.score >= 75);
  assert.equal(r.blockers[0].id, 'm');
  assert.equal(r.band, 'Almost ready');
});

test('manager blend is 40/60 and big disagreement is flagged', () => {
  const r = computeResult([q('a', 4, 'Must Have')], { self: { a: { rating: 4 } }, manager: { a: { rating: 1 } } });
  assert.equal(r.skills[0].effective, 0.4 * 4 + 0.6 * 1);
  assert.equal(r.skills[0].perception, 'self-higher');
});

test('skipped skills are excluded and reported in coverage', () => {
  const r = computeResult([q('a', 2, 'Must Have'), q('b', 2, 'Must Have')], { self: { a: { rating: 2 }, b: { skipped: true } } });
  assert.equal(r.score, 100);
  assert.deepEqual(r.coverage, { rated: 1, total: 2, weightPct: 50 });
});

test('questions are built for every role and level', () => {
  for (const role of ['developer', 'mobile-android', 'mobile-ios', 'qa', 'tech-support', 'data-engineer', 'em']) {
    const r = getRole(role);
    for (let i = 0; i < r.levels.length - 1; i++) {
      const { questions, targetLevel } = buildQuestions(r, r.levels[i].name);
      assert.equal(targetLevel, r.levels[i + 1].name);
      for (const x of questions) assert.ok(x.targetStep >= 1 && x.targetStep <= r.scale.length, `${role}/${x.title}`);
    }
    assert.throws(() => buildQuestions(r, r.levels.at(-1).name), /top level/);
  }
});

test('every authored scenario is attached to a skill, with a full tier spread', () => {
  const scenarios = JSON.parse(readFileSync(new URL('../data/scenarios.json', import.meta.url), 'utf8'));
  const expected = scenarios.reduce((n, sc) => n + sc.roles.length, 0);
  assert.equal(loadMatrix().roles.reduce((n, r) => n + r.skills.filter((s) => s.scenario).length, 0), expected);
  for (const sc of scenarios) assert.deepEqual(sc.options.map((o) => o.tier).sort(), [0, 1, 2, 3], sc.skill);
});

test('scenario answer is blended into the self rating and mismatches are flagged', () => {
  const base = { ...q('a', 4, 'Must Have'), scenarioSteps: { good: 4, bad: 0 } };
  const rated = (scenario) => computeResult([base], { self: { a: { rating: 4, scenario } } });
  assert.equal(rated(undefined).skills[0].effective, 4);
  assert.equal(rated('bad').skills[0].effective, 2);
  assert.equal(rated('bad').skills[0].scenarioFlag, 'below-rating');
  assert.equal(computeResult([base], { self: { a: { skipped: true, scenario: 'good' } } }).skills[0].effective, null);
});

test('quick check is short, favours scenario skills, and hides answer keys', () => {
  const role = getRole('developer');
  const full = buildQuestions(role, 'Product Engineer');
  const quick = buildQuestions(role, 'Product Engineer', { quick: true });
  assert.ok(quick.questions.length <= 8 && quick.questions.length < full.questions.length);
  assert.ok(quick.questions.filter((x) => x.scenario).length >= 5);
});

// ---------- directory: deriving role / level / manager ----------
const emp = (o) => ({ id: 'E?', name: 'X', email: 'x@rapido.bike', parent_department: 'Engineering', department: 'Fullstack', designation: '', functional_title: '', band: '', manager_id: null, manager_name: null, ...o });

test('level is derived from the band, falling back to the designation when the band is blank', () => {
  const t = resolveTarget(emp({ band: 'L-9' }));
  assert.deepEqual([t.status, t.roleId, t.currentLevel, t.targetLevel], ['ready', 'developer', 'Product Engineer', 'Senior Product Engineer 1']);
  assert.equal(resolveTarget(emp({ band: 'L-10' })).currentLevel, 'Product Engineer');
  const viaTitle = resolveTarget(emp({ department: 'QA', band: '', designation: 'Professional 2' }));
  assert.deepEqual([viaTitle.roleId, viaTitle.currentLevel, viaTitle.targetLevel], ['qa', 'Product Test Engineer 2', 'Senior Product Test Engineer1']);
  assert.equal(resolveTarget(emp({ department: 'Mobile - IOS', band: 'L-8' })).roleId, 'mobile-ios');
  assert.equal(resolveTarget(emp({ department: 'Data Engineering', band: 'L-8' })).currentLevel, 'SDE1');
  assert.equal(resolveTarget(emp({ department: 'Technical Support', band: 'L-9' })).targetLevel, 'Senior Technical Support Engineer 1');
});

test('people who cannot be auto-assigned get a clear status', () => {
  assert.equal(resolveTarget(emp({ department: 'Devops', band: 'L-9' })).status, 'unsupported-team');
  assert.equal(resolveTarget(emp({ parent_department: 'Operations', department: 'City Ops', band: 'L-9' })).status, 'no-matrix');
  assert.equal(resolveTarget(emp({ band: '', designation: 'Consultant' })).status, 'no-level');
  assert.equal(resolveTarget(emp({ department: 'Technical Support', band: 'L-7' })).status, 'top-level');
  assert.equal(resolveTarget(emp({ band: 'L-3B' })).status, 'top-level');
});

// ---------- API ----------
const PEOPLE = [
  emp({ id: 'E1', name: 'Roshni Parti', email: 'roshni.parti@rapido.bike', parent_department: 'People and Culture', department: 'Talent Management', band: 'L-9', manager_id: 'E9', manager_name: 'Boss' }),
  emp({ id: 'E2', name: 'Asha Dev', email: 'asha@rapido.bike', band: 'L-9', manager_id: 'E3', manager_name: 'Ravi Lead' }),
  emp({ id: 'E3', name: 'Ravi Lead', email: 'ravi@rapido.bike', band: 'L-6', manager_id: 'E9', manager_name: 'Boss' }),
  emp({ id: 'E4', name: 'Other Dev', email: 'other@rapido.bike', band: 'L-8', manager_id: 'E3', manager_name: 'Ravi Lead' }),
  emp({ id: 'E5', name: 'Ops Person', email: 'ops@rapido.bike', parent_department: 'Operations', department: 'City Ops', band: 'L-9', manager_id: 'E9', manager_name: 'Boss' }),
  emp({ id: 'E6', name: 'Quinn QA', email: 'quinn@rapido.bike', department: 'QA', band: '', designation: 'Professional 2', manager_id: 'E3', manager_name: 'Ravi Lead' }),
  emp({ id: 'E7', name: 'Foreign Dev', email: 'foreign@ownly.food', band: 'L-9', manager_id: 'E3', manager_name: 'Ravi Lead' }),
];

async function harness() {
  const db = await openDb({ memory: true });
  await upsertEmployees(db, PEOPLE);
  const google = { 'g-roshni': { email: 'roshni.parti@rapido.bike', emailVerified: true, hd: 'rapido.bike' }, 'g-asha': { email: 'asha@rapido.bike', emailVerified: true, hd: 'rapido.bike' },
    'g-foreign': { email: 'foreign@ownly.food', emailVerified: true }, 'g-unverified': { email: 'asha@rapido.bike', emailVerified: false }, 'g-stranger': { email: 'nobody@rapido.bike', emailVerified: true, hd: 'rapido.bike' } };
  const app = createApp(db, { adminEmails: 'roshni.parti@rapido.bike', devLogin: true, verifyGoogle: async (c) => { if (!google[c]) throw new Error('bad token'); return google[c]; } });
  const server = app.listen(0);
  const base = `http://localhost:${server.address().port}`;
  const client = () => {
    let cookie = '';
    const call = async (method, path, body) => {
      const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
      const set = res.headers.getSetCookie?.()[0];
      if (set) cookie = set.split(';')[0];
      return { status: res.status, body: await res.json() };
    };
    return { call, google: (c) => call('POST', '/api/auth/google', { credential: c }), dev: (email) => call('POST', '/api/auth/dev', { email }) };
  };
  return { client, close: () => { server.closeAllConnections(); server.close(); } };
}

test('Google sign-in: only verified @rapido.bike accounts that are active employees', async () => {
  const h = await harness();
  try {
    const anon = h.client();
    assert.equal((await anon.call('GET', '/api/me')).status, 401);
    assert.equal((await anon.google('bogus')).status, 401);
    assert.equal((await anon.google('g-foreign')).status, 403); // other domain
    assert.equal((await anon.google('g-unverified')).status, 403);
    assert.equal((await anon.google('g-stranger')).status, 403); // not in the master data
    assert.equal((await anon.call('GET', '/api/me')).status, 401);
    assert.equal((await anon.google('g-asha')).status, 200);
    const me = (await anon.call('GET', '/api/me')).body;
    assert.equal(me.user.email, 'asha@rapido.bike');
    assert.equal(me.isAdmin, false);
    assert.deepEqual([me.target.roleName, me.target.currentLevel, me.target.targetLevel], ['Developer', 'Product Engineer', 'Senior Product Engineer 1']);
    assert.equal(me.employee.managerName, 'Ravi Lead');
  } finally { h.close(); }
});

test('an employee gets their own level and manager, and cannot override them or use admin features', async () => {
  const h = await harness();
  try {
    const asha = h.client(); await asha.google('g-asha');
    for (const body of [{ roleId: 'em', currentLevel: 'Engineering Manager 1' }, { quick: true }, { asEmployeeId: 'E4' }]) assert.equal((await asha.call('POST', '/api/assessments', body)).status, 403);
    assert.equal((await asha.call('GET', '/api/roles')).status, 403);
    assert.equal((await asha.call('GET', '/api/admin/employees')).status, 403);
    const a = (await asha.call('POST', '/api/assessments', {})).body;
    assert.deepEqual([a.currentLevel, a.targetLevel, a.managerName, a.isTest], ['Product Engineer', 'Senior Product Engineer 1', 'Ravi Lead', false]);

    const ops = h.client(); await ops.dev('ops@rapido.bike');
    const r = await ops.call('POST', '/api/assessments', {});
    assert.equal(r.status, 422);
    assert.match(r.body.error, /isn't ready yet/);
  } finally { h.close(); }
});

test('manager review is only for the direct manager; scenarios and employee ratings stay hidden', async () => {
  const h = await harness();
  try {
    const asha = h.client(); await asha.dev('asha@rapido.bike');
    const a = (await asha.call('POST', '/api/assessments', {})).body;
    const detail = (await asha.call('GET', `/api/assessments/${a.id}`)).body;
    assert.equal(JSON.stringify(detail).includes('scenarioSteps'), false, 'answer key leaked');

    const ravi = h.client(); await ravi.dev('ravi@rapido.bike');
    assert.equal((await ravi.call('GET', `/api/review/${a.id}`)).status, 409); // not submitted yet

    const answers = Object.fromEntries(detail.questions.map((x) => [x.id, { rating: x.targetStep, evidence: 'did it', scenario: x.scenario?.options[0].id }]));
    assert.equal((await asha.call('PUT', `/api/assessments/${a.id}/self`, { responses: answers, submit: true })).body.selfSubmitted, true);

    const other = h.client(); await other.dev('other@rapido.bike'); // a peer, not the manager
    assert.equal((await other.call('GET', `/api/review/${a.id}`)).status, 403);
    assert.equal((await asha.call('GET', `/api/review/${a.id}`)).status, 403); // nor the employee themself

    assert.equal((await ravi.call('GET', '/api/me')).body.reviewsWaiting, 1);
    const queue = (await ravi.call('GET', '/api/reviews')).body;
    assert.deepEqual(queue.map((x) => x.employeeName), ['Asha Dev']);
    const review = (await ravi.call('GET', `/api/review/${a.id}`)).body;
    assert.ok(review.questions.every((x) => x.scenario === null));
    assert.equal(review.employeeEvidence[detail.questions[0].id], 'did it');
    assert.equal(JSON.stringify(review).includes('"scenario":"o'), false);

    const mgr = Object.fromEntries(detail.questions.map((x) => [x.id, { rating: 0 }]));
    const done = await ravi.call('PUT', `/api/review/${a.id}`, { responses: mgr, submit: true });
    assert.equal(done.body.managerSubmitted, true);

    const { result } = (await asha.call('GET', `/api/assessments/${a.id}/result`)).body;
    assert.match(result.basis, /manager/);
    assert.ok(result.perceptionGaps.length > 0 && result.recommendations.length > 0);
    assert.equal((await ravi.call('GET', '/api/me')).body.reviewsWaiting, 0);
  } finally { h.close(); }
});

test('admin demo flow: quick check, manual picker and taking the test as another employee, all kept apart from real data', async () => {
  const h = await harness();
  try {
    const roshni = h.client(); await roshni.google('g-roshni');
    assert.equal((await roshni.call('GET', '/api/me')).body.isAdmin, true);
    assert.equal((await roshni.call('GET', '/api/me')).body.target.status, 'no-matrix'); // People & Culture has no matrix

    const roles = (await roshni.call('GET', '/api/roles')).body;
    assert.ok(roles.some((r) => r.id === 'qa'));
    const quick = (await roshni.call('POST', '/api/assessments', { roleId: 'developer', currentLevel: 'Product Engineer', quick: true })).body;
    assert.deepEqual([quick.quick, quick.isTest], [true, true]);

    const people = (await roshni.call('GET', '/api/admin/employees')).body;
    const names = people.map((p) => p.name);
    assert.ok(names.includes('Asha Dev') && names.includes('Quinn QA'));
    assert.ok(!names.includes('Ops Person') && !names.includes('Roshni Parti'));
    assert.deepEqual(people.find((p) => p.name === 'Quinn QA'), { id: 'E6', name: 'Quinn QA', email: 'quinn@rapido.bike', roleName: 'Quality Analyst', currentLevel: 'Product Test Engineer 2', targetLevel: 'Senior Product Test Engineer1', managerName: 'Ravi Lead' });

    const as = (await roshni.call('POST', '/api/assessments', { asEmployeeId: 'E2' })).body;
    assert.deepEqual([as.isTest, as.subjectName, as.currentLevel, as.managerName], [true, 'Asha Dev', 'Product Engineer', 'Ravi Lead']);
    const detail = (await roshni.call('GET', `/api/assessments/${as.id}`)).body;
    const answers = Object.fromEntries(detail.questions.map((x) => [x.id, { rating: x.targetStep }]));
    await roshni.call('PUT', `/api/assessments/${as.id}/self`, { responses: answers, submit: true });

    // the real manager and the real employee never see the test run
    const ravi = h.client(); await ravi.dev('ravi@rapido.bike');
    assert.equal((await ravi.call('GET', '/api/me')).body.reviewsWaiting, 0);
    assert.deepEqual((await ravi.call('GET', '/api/reviews')).body, []);
    assert.equal((await ravi.call('GET', `/api/review/${as.id}`)).status, 403);
    const asha = h.client(); await asha.dev('asha@rapido.bike');
    assert.deepEqual((await asha.call('GET', '/api/assessments')).body, []);
    assert.equal((await asha.call('GET', `/api/assessments/${as.id}`)).status, 404);

    // the admin plays the manager on their own test run
    const mgr = Object.fromEntries(detail.questions.map((x) => [x.id, { rating: 1 }]));
    assert.equal((await roshni.call('PUT', `/api/review/${as.id}`, { responses: mgr, submit: true })).body.managerSubmitted, true);
    assert.match((await roshni.call('GET', `/api/assessments/${as.id}/result`)).body.result.basis, /manager/);

    // someone who cannot be assessed is refused
    assert.equal((await roshni.call('POST', '/api/assessments', { asEmployeeId: 'E5' })).status, 422);
  } finally { h.close(); }
});

test('dev login is off when disabled, and sessions cannot be forged', async () => {
  const db = await openDb({ memory: true });
  await upsertEmployees(db, PEOPLE);
  const app = createApp(db, { devLogin: false, sessionSecret: 'a-real-secret' });
  const server = app.listen(0);
  const base = `http://localhost:${server.address().port}`;
  try {
    const dev = await fetch(base + '/api/auth/dev', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'asha@rapido.bike' }) });
    assert.equal(dev.status, 404);
    const forged = await fetch(base + '/api/me', { headers: { cookie: 'session=' + Buffer.from('{"uid":1,"exp":9999999999999}').toString('base64url') + '.AAAA' } });
    assert.equal(forged.status, 401);
    const cross = await fetch(base + '/api/auth/logout', { method: 'POST', headers: { origin: 'https://evil.example', 'content-type': 'application/json' }, body: '{}' });
    assert.equal(cross.status, 403);
  } finally { server.closeAllConnections(); server.close(); }
});
