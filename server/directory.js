// Employee directory: lookups against the `employees` table and deriving (role, level, manager) from them.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { getRole } from './matrix.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAP_PATH = process.env.LEVEL_MAP_PATH ?? path.join(ROOT, 'data', 'level-map.json');
let mapCache;
/** Read on first use (not at import) so a missing file is reported clearly instead of crashing the whole server. */
export function levelMap() {
  if (!mapCache) {
    try { mapCache = JSON.parse(readFileSync(MAP_PATH, 'utf8')); }
    catch (e) { throw new Error(`Could not read data/level-map.json (${e.code ?? e.message})`); }
  }
  return mapCache;
}

export const normEmail = (e) => String(e ?? '').trim().toLowerCase();

export const getEmployeeByEmail = (db, email) => db.one('SELECT * FROM employees WHERE email=$1', [normEmail(email)]);
export const getEmployeeById = (db, id) => db.one('SELECT * FROM employees WHERE id=$1', [id]);

export async function upsertEmployees(db, list) {
  for (const e of list) {
    await db.run(
      `INSERT INTO employees (id,name,email,parent_department,department,designation,functional_title,band,manager_id,manager_name)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name,email=EXCLUDED.email,parent_department=EXCLUDED.parent_department,
         department=EXCLUDED.department,designation=EXCLUDED.designation,functional_title=EXCLUDED.functional_title,
         band=EXCLUDED.band,manager_id=EXCLUDED.manager_id,manager_name=EXCLUDED.manager_name`,
      [e.id, e.name, normEmail(e.email), e.parent_department ?? '', e.department ?? '', e.designation ?? '', e.functional_title ?? '', e.band ?? '', e.manager_id ?? null, e.manager_name ?? null],
    );
  }
}

/**
 * What can this employee be assessed against?
 * status: 'ready' | 'no-matrix' | 'unsupported-team' | 'no-level' | 'top-level'
 */
export function resolveTarget(emp) {
  if (!emp) return { status: 'no-matrix', message: 'No employee record found.' };
  const unsupported = levelMap().unsupportedDepartments[emp.department];
  if (unsupported) return { status: 'unsupported-team', message: unsupported };
  const roleId = levelMap().supportedParentDepartments.includes(emp.parent_department) ? levelMap().roleByDepartment[emp.department] : null;
  if (!roleId) return { status: 'no-matrix', message: `The skill matrix for ${emp.parent_department || 'your function'}${emp.department && emp.department !== emp.parent_department ? ' (' + emp.department + ')' : ''} isn't ready yet. You'll be able to take the assessment once it is released.` };
  const band = emp.band || levelMap().bandByDesignation[emp.designation] || '';
  const role = getRole(roleId);
  const currentLevel = levelMap().levelByBand[roleId]?.[band];
  if (!currentLevel || !role.levels.some((l) => l.name === currentLevel)) {
    return { status: 'no-level', roleId, roleName: role.name, message: `We couldn't work out your level (band "${emp.band || 'blank'}", title "${emp.designation || emp.functional_title || 'unknown'}"). Please ask HR to update your band in the employee master.` };
  }
  const idx = role.levels.findIndex((l) => l.name === currentLevel);
  const next = role.levels[idx + 1];
  if (!next) return { status: 'top-level', roleId, roleName: role.name, currentLevel, message: `${currentLevel} is the top level of the ${role.name} track, so there is no next level to assess.` };
  return { status: 'ready', roleId, roleName: role.name, currentLevel, targetLevel: next.name, band };
}

/** Employees an admin can take the test as: everyone with a 'ready' target. */
export async function listAssessable(db) {
  const rows = await db.query("SELECT * FROM employees WHERE parent_department = ANY($1) ORDER BY name", [levelMap().supportedParentDepartments]);
  return rows.map((e) => ({ e, t: resolveTarget(e) })).filter(({ t }) => t.status === 'ready')
    .map(({ e, t }) => ({ id: e.id, name: e.name, email: e.email, roleName: t.roleName, currentLevel: t.currentLevel, targetLevel: t.targetLevel, managerName: e.manager_name }));
}
