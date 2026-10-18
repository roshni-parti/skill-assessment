// Pure functions: questions for a level move, and scoring / gap analysis from responses.
import { GENERIC_DESCRIPTORS, stepForTier } from './normalise.js';

export const GATE_WEIGHT = { 'Must Have': 3, 'Should Have': 2, 'Good to Have': 1 };
const DEFAULT_WEIGHT = 2; // skills with no gate in the sheet (e.g. Data Engineer)
export const WEIGHTS = { self: 0.4, manager: 0.6 };
export const PERCEPTION_GAP_STEPS = 2;
export const SCENARIO_WEIGHT = 0.5; // share of the self figure that comes from the scenario answer
export const QUICK_SIZE = 8;
export const BANDS = [
  { min: 75, label: 'Ready' },
  { min: 50, label: 'Developing' },
  { min: 0, label: 'Early' },
];

const stepOf = (role, proficiency) => role.scale.indexOf(proficiency) + 1; // 0 = not demonstrating yet
const bullets = (text) => (text ?? '').split('\n').map((l) => l.trim().replace(/^[-•]\s*/, '')).filter(Boolean);

/** Skills that apply to the move from currentLevel to the next one, with answer options. */
export function buildQuestions(role, currentLevel, { quick = false } = {}) {
  const idx = role.levels.findIndex((l) => l.name === currentLevel);
  if (idx < 0) throw new Error(`Unknown level "${currentLevel}" for ${role.name}`);
  const next = role.levels[idx + 1];
  if (!next) throw new Error(`${currentLevel} is the top level of the ${role.name} track`);

  const questions = [];
  for (const s of role.skills) {
    const target = s.targets[next.name];
    if (!target || target.proficiency === 'Not Applicable') continue;
    const targetStep = stepOf(role, target.proficiency);
    if (targetStep < 1) continue;
    const cur = s.targets[currentLevel];
    const curStep = cur && cur.proficiency !== 'Not Applicable' ? stepOf(role, cur.proficiency) : 0;
    const options = [{ value: 0, label: 'Not yet', text: 'I am not yet demonstrating this.', generic: false }];
    role.scale.forEach((p, i) => {
      const text = s.descriptors[p];
      options.push({ value: i + 1, label: p, text: text ?? GENERIC_DESCRIPTORS[p] ?? '', generic: !text });
    });
    const firstBullet = bullets(s.descriptors[target.proficiency])[0];
    questions.push({
      id: s.id,
      area: s.area || 'General',
      title: s.title,
      details: s.details,
      gate: target.gate,
      targetProficiency: target.proficiency,
      targetStep,
      currentStep: curStep,
      stretch: targetStep > curStep,
      options,
      scenario: s.scenario ? { situation: s.scenario.situation, options: shuffled(s.scenario.options.map(({ id, text }) => ({ id, text })), s.id) } : null,
      scenarioSteps: s.scenario ? Object.fromEntries(s.scenario.options.map((o) => [o.id, stepForTier(o.tier, role.scale.length)])) : null,
      prompt: firstBullet
        ? `Share a recent example of when you were able to: ${firstBullet.replace(/[.;]$/, '')}.`
        : `Share a recent example that shows your level in ${s.title}.`,
    });
  }
  return { currentLevel, targetLevel: next.name, questions: quick ? pickQuick(questions) : questions };
}

/** Strip answer keys before sending questions to a browser. */
export const publicQuestion = ({ scenarioSteps, ...q }) => q;

// Deterministic shuffle so the best answer isn't always in the same position (and is stable between loads).
function shuffled(list, seed) {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) { h = Math.imul(h ^ (h >>> 15), 2246822519) >>> 0; const j = h % (i + 1); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}

/** Short version: the most telling skills (scenario-backed, Must Have, step-ups), at most 2 per area first, in sheet order. */
function pickQuick(questions, n = QUICK_SIZE) {
  const rank = (q) => (q.scenario ? 4 : 0) + (q.gate === 'Must Have' ? 2 : 0) + (q.stretch ? 1 : 0);
  const sorted = questions.map((q, i) => ({ q, i })).sort((a, b) => rank(b.q) - rank(a.q) || a.i - b.i);
  const picked = [];
  const perArea = {};
  for (const x of sorted) { if (picked.length < n && (perArea[x.q.area] ?? 0) < 2) { picked.push(x); perArea[x.q.area] = (perArea[x.q.area] ?? 0) + 1; } }
  for (const x of sorted) if (picked.length < n && !picked.includes(x)) picked.push(x);
  return picked.sort((a, b) => a.i - b.i).map((x) => x.q);
}

const weightOf = (q) => GATE_WEIGHT[q.gate] ?? DEFAULT_WEIGHT;
const bandFor = (score) => BANDS.find((b) => score >= b.min).label;

/**
 * responses: { self: {skillId: {rating, skipped}}, manager: {...} | null }
 * Per skill: blend of self and manager when both exist, otherwise whichever exists.
 */
export function computeResult(questions, responses) {
  const self = responses.self ?? {};
  const mgr = responses.manager ?? {};
  const hasManager = Object.values(mgr).some((r) => r && !r.skipped && r.rating != null);

  const skills = questions.map((q) => {
    const raw = self[q.id] && !self[q.id].skipped ? self[q.id].rating : null;
    const scenarioStep = raw != null && q.scenarioSteps ? q.scenarioSteps[self[q.id].scenario] ?? null : null;
    const s = scenarioStep != null ? (1 - SCENARIO_WEIGHT) * raw + SCENARIO_WEIGHT * scenarioStep : raw;
    const m = mgr[q.id] && !mgr[q.id].skipped ? mgr[q.id].rating : null;
    let effective = null;
    if (s != null && m != null) effective = WEIGHTS.self * s + WEIGHTS.manager * m;
    else if (m != null) effective = m;
    else if (s != null) effective = s;
    const weight = weightOf(q);
    const ratio = effective == null ? null : Math.min(effective / q.targetStep, 1);
    const gap = effective == null ? null : Math.max(q.targetStep - effective, 0);
    return {
      id: q.id, area: q.area, title: q.title, gate: q.gate, weight,
      targetStep: q.targetStep, targetProficiency: q.targetProficiency, stretch: q.stretch,
      self: raw, selfAdjusted: scenarioStep != null ? s : null, scenario: scenarioStep,
      scenarioFlag: scenarioStep == null ? null : Math.abs(raw - scenarioStep) >= PERCEPTION_GAP_STEPS ? (scenarioStep < raw ? 'below-rating' : 'above-rating') : null,
      manager: m, effective, ratio, gap,
      blocker: q.gate === 'Must Have' && gap != null && gap > 0.001,
      perception: s != null && m != null && Math.abs(s - m) >= PERCEPTION_GAP_STEPS ? (s > m ? 'self-higher' : 'manager-higher') : null,
      priority: gap == null ? 0 : gap * weight,
    };
  });

  const rated = skills.filter((s) => s.ratio != null);
  const totalWeight = skills.reduce((a, s) => a + s.weight, 0);
  const ratedWeight = rated.reduce((a, s) => a + s.weight, 0);
  const score = ratedWeight ? Math.round((rated.reduce((a, s) => a + s.weight * s.ratio, 0) / ratedWeight) * 100) : 0;

  const byArea = {};
  for (const s of skills) (byArea[s.area] ??= []).push(s);
  const areas = Object.entries(byArea).map(([area, list]) => {
    const r = list.filter((s) => s.ratio != null);
    const w = r.reduce((a, s) => a + s.weight, 0);
    return { area, score: w ? Math.round((r.reduce((a, s) => a + s.weight * s.ratio, 0) / w) * 100) : null, skills: list.length, rated: r.length };
  });

  const blockers = skills.filter((s) => s.blocker);
  let band = rated.length ? bandFor(score) : 'Not rated';
  if (band === 'Ready' && blockers.length) band = 'Almost ready';

  return {
    score,
    band,
    basis: hasManager ? 'self + manager' : 'self only (provisional)',
    weights: hasManager ? WEIGHTS : { self: 1, manager: 0 },
    coverage: { rated: rated.length, total: skills.length, weightPct: totalWeight ? Math.round((ratedWeight / totalWeight) * 100) : 0 },
    areas,
    skills,
    gaps: skills.filter((s) => s.gap > 0.001).sort((a, b) => b.priority - a.priority),
    strengths: rated.filter((s) => s.gap <= 0.001).sort((a, b) => b.weight - a.weight),
    blockers,
    perceptionGaps: skills.filter((s) => s.perception),
    scenarioFlags: skills.filter((s) => s.scenarioFlag),
    scenarioCount: skills.filter((s) => s.scenario != null).length,
  };
}
