// Browser-safe: no Node imports. Shared by the server and the static demo.
const STANDARD_ORDER = ['Beginner', 'Intermediate', 'Advanced', 'Expert'];
const DREYFUS_ORDER = ['Novice', 'Advanced Beginner', 'Competent', 'Proficient', 'Expert'];

// Generic wording from the Legends tab, used when a skill has no behavioural descriptor of its own.
export const GENERIC_DESCRIPTORS = {
  Beginner: 'Basic understanding and minimal experience; can perform simple tasks with guidance.',
  Intermediate: 'Solid understanding and moderate experience; can perform tasks independently with a good success rate.',
  Advanced: 'Deep experience; handles complex situations independently and helps others.',
  Expert: 'Highest level of mastery; recognised as an authority, capable of leading, innovating and teaching others.',
  Novice: 'Understands the competency and its importance but is not yet demonstrating it.',
  'Advanced Beginner': 'Demonstrates this competency under supervision or with encouragement.',
  Competent: 'Demonstrates this competency independent of supervision or encouragement.',
  Proficient: 'Encourages or supervises others in this competency.',
};

function buildScale(role) {
  const used = new Set();
  const descUsed = new Set();
  for (const s of role.skills) {
    for (const t of Object.values(s.targets)) used.add(t.proficiency);
    for (const p of Object.keys(s.descriptors)) descUsed.add(p);
  }
  const dreyfus = [...used, ...descUsed].some((p) => ['Novice', 'Advanced Beginner', 'Competent', 'Proficient'].includes(p));
  if (dreyfus) return { steps: DREYFUS_ORDER.filter((p) => used.has(p) || descUsed.has(p) || p === 'Expert'), alias: {} };
  // Tech Support targets use Expert but its descriptors say Advanced for the top step: treat them as the same step.
  const alias = {};
  if (!used.has('Advanced') && descUsed.has('Advanced') && !descUsed.has('Expert')) alias.Advanced = 'Expert';
  const present = new Set([...used, ...[...descUsed].map((p) => alias[p] ?? p)]);
  return { steps: STANDARD_ORDER.filter((p) => present.has(p)), alias };
}

export function normaliseRole(role) {
  const { steps, alias } = buildScale(role);
  const skills = role.skills.map((s) => {
    const descriptors = {};
    for (const [p, text] of Object.entries(s.descriptors)) descriptors[alias[p] ?? p] = text;
    return { ...s, descriptors };
  });
  return { ...role, skills, scale: steps };
}


const keyOf = (t) => String(t ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');

/** Attach authored scenarios (data/scenarios.json) to the matching skill of each role. Returns titles that matched nothing. */
export function applyScenarios(roles, scenarios) {
  const byId = Object.fromEntries(roles.map((r) => [r.id, r]));
  const unmatched = [];
  for (const sc of scenarios) {
    for (const roleId of sc.roles) {
      const skill = byId[roleId]?.skills.find((x) => keyOf(x.title) === keyOf(sc.skill) && !x.scenario);
      if (!skill) { unmatched.push(`${roleId}: ${sc.skill}`); continue; }
      skill.scenario = { situation: sc.situation, options: sc.options.map((o, i) => ({ id: `o${i}`, text: o.text, tier: o.tier })) };
    }
  }
  return unmatched;
}

/** Map a scenario answer tier (0 weak .. 3 expert) onto a role's proficiency scale of n steps (0 = not demonstrating). */
export const stepForTier = (tier, n) => (tier <= 0 ? 0 : tier === 1 ? 1 : tier >= 3 ? n : Math.ceil(n / 2));
