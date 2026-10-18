// Loads data/matrix.json and normalises each role into a shape the assessment engine can use:
// an ordered proficiency scale, ordered levels and skills with per-level targets.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { applyScenarios, normaliseRole } from './normalise.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MATRIX_PATH = process.env.MATRIX_PATH ?? path.join(ROOT, 'data', 'matrix.json');
const SCENARIOS_PATH = process.env.SCENARIOS_PATH ?? path.join(ROOT, 'data', 'scenarios.json');

let cache;
export function loadMatrix() {
  if (cache) return cache;
  const raw = JSON.parse(readFileSync(MATRIX_PATH, 'utf8'));
  const roles = raw.roles.map(normaliseRole);
  let unmatchedScenarios = [];
  try { unmatchedScenarios = applyScenarios(roles, JSON.parse(readFileSync(SCENARIOS_PATH, 'utf8'))); } catch { /* scenarios are optional */ }
  if (unmatchedScenarios.length) console.warn('Scenarios with no matching skill:', unmatchedScenarios);
  cache = { function: raw.function, importedAt: raw.importedAt, roles, byId: Object.fromEntries(roles.map((r) => [r.id, r])) };
  return cache;
}

export const getRole = (id) => loadMatrix().byId[id];

export function listRoles() {
  return loadMatrix().roles.map((r) => ({
    id: r.id,
    name: r.name,
    levels: r.levels.map((l, i) => ({ name: l.name, jobLevel: l.jobLevel, hasNext: i < r.levels.length - 1 })),
  }));
}
