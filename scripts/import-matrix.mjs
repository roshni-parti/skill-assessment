// Usage: node scripts/import-matrix.mjs [path/to/engineering.xlsx] [out.json]
// Converts the Engineering skill-matrix workbook into a normalised matrix.json.
// Hidden sheets are ignored. Re-runnable whenever the sheet is refreshed.
import ExcelJS from 'exceljs';
import { writeFileSync } from 'node:fs';

const SRC = process.argv[2] ?? 'data/engineering.xlsx';
const OUT = process.argv[3] ?? 'data/matrix.json';

// Roles -> [matrix sheet, competencies sheet | null]. DevOps exists only in a hidden "(old)" tab, so it is skipped.
const ROLES = [
  { id: 'developer', name: 'Developer', matrix: 'Developer', comps: 'Developer Competencies' },
  { id: 'mobile-android', name: 'Mobile - Android', matrix: 'Mobile-Android', comps: 'Mobile-Android Competencies' },
  { id: 'mobile-ios', name: 'Mobile - iOS', matrix: 'Mobile-iOS', comps: 'Mobile-iOS Competencies' },
  { id: 'qa', name: 'Quality Analyst', matrix: 'Quality Analyst', comps: 'QA Competencies' },
  { id: 'tech-support', name: 'Tech Support', matrix: 'Tech Support', comps: 'Tech Support Competencies' },
  { id: 'data-engineer', name: 'Data Engineer', matrix: 'Data Engineer', comps: null, layout: 'inline' },
  { id: 'em', name: 'Engineering Manager', matrix: 'EM', comps: 'EM Competencies' },
];

// Longest first so "Advanced Beginner" wins over "Advanced"/"Beginner".
const PROFICIENCIES = ['Not Applicable', 'Advanced Beginner', 'Beginner', 'Intermediate', 'Advanced', 'Expert', 'Novice', 'Competent', 'Proficient'];
const GATES = ['Must Have', 'Should Have', 'Good to Have', 'Not Applicable'];

const clean = (s) => String(s ?? '').replace(/\r/g, '').trim();
const oneLine = (s) => clean(s).replace(/\s+/g, ' ');
const key = (s) => clean(s).toLowerCase().replace(/[^a-z0-9]+/g, '');
const matchFrom = (list, text) => {
  const t = clean(text).toLowerCase();
  return list.find((p) => t.startsWith(p.toLowerCase())) ?? null;
};
const cellText = (ws, r, c) => clean(ws.getCell(r, c).text);

function splitSkill(raw) {
  const lines = clean(raw).split('\n').map((l) => l.trim()).filter(Boolean);
  return { title: lines[0]?.replace(/^"/, '') ?? '', details: lines.slice(1).map((l) => l.replace(/^[-•]\s*/, '')).filter(Boolean) };
}

function findHeader(ws) {
  for (let r = 1; r <= Math.min(ws.rowCount, 15); r++) {
    for (let c = 1; c <= 3; c++) {
      if (cellText(ws, r, c).toLowerCase() === 'areas of expertise') return { r, c };
    }
  }
  return null;
}

function parseMatrix(ws, role, warnings) {
  const h = findHeader(ws);
  if (!h) { warnings.push(`${role.name}: header row not found`); return null; }
  const inline = role.layout === 'inline';
  // Standard: [Area][Skills][levels...]. Data Engineer: [Category][Area = skill title][Skills = details][levels...]
  const areaCol = inline ? h.c - 1 : h.c;
  const titleCol = inline ? h.c : h.c + 1;
  const detailCol = inline ? h.c + 1 : null;
  const firstLevelCol = h.c + 2;

  const levels = [];
  for (let c = firstLevelCol; c <= ws.columnCount; c++) {
    const name = oneLine(cellText(ws, h.r, c));
    if (!name) break;
    const above = cellText(ws, h.r - 1, c);
    let jobLevel = /^\d+(\.\d+)?$/.test(above) ? Number(above) : null;
    const paren = name.match(/\(L(\d+)\)/);
    if (paren) jobLevel = Number(paren[1]);
    levels.push({ col: c, name: name.replace(/\s*\(L\d+\)/, '').trim(), jobLevel });
  }

  const skills = [];
  let area = '';
  for (let r = h.r + 1; r <= ws.rowCount; r++) {
    const levelCells = levels.map((l) => cellText(ws, r, l.col));
    if (!levelCells.some(Boolean)) continue;
    const isGateRow = levelCells.filter(Boolean).every((v) => GATES.some((g) => g.toLowerCase() === v.toLowerCase()));
    if (isGateRow && !inline) {
      const s = skills[skills.length - 1];
      if (!s) continue;
      levels.forEach((l, i) => {
        const g = GATES.find((x) => x.toLowerCase() === levelCells[i].toLowerCase());
        if (g && s.targets[l.name]) s.targets[l.name].gate = g;
      });
      continue;
    }
    const titleRaw = cellText(ws, r, titleCol);
    if (!titleRaw) continue;
    area = cellText(ws, r, areaCol) || area;
    const { title, details } = splitSkill(titleRaw);
    const extra = detailCol ? splitSkill(cellText(ws, r, detailCol)) : null;
    const skill = {
      id: `${role.id}:${key(title)}`,
      area: inline ? cellText(ws, r, areaCol) : area,
      title,
      details: inline ? (extra?.title ? [extra.title, ...extra.details] : []) : details,
      targets: {},
      descriptors: {},
    };
    levels.forEach((l, i) => {
      const v = levelCells[i];
      if (!v) return;
      const prof = matchFrom(PROFICIENCIES, v);
      if (!prof) { warnings.push(`${role.name} / ${skill.title} / ${l.name}: unrecognised proficiency "${oneLine(v).slice(0, 40)}"`); return; }
      skill.targets[l.name] = { proficiency: prof, gate: null };
      if (inline) {
        const body = clean(v).split('\n').slice(1).map((x) => x.trim().replace(/^[-•]\s*/, '')).filter(Boolean).join('\n');
        if (body && !skill.descriptors[prof]) skill.descriptors[prof] = body;
      }
    });
    // Some sheets repeat a skill title (e.g. QA "Mobile Testing"); keep ids unique.
    const clash = skills.filter((x) => x.id === skill.id || x.id.startsWith(`${skill.id}~`)).length;
    if (clash) { skill.id = `${skill.id}~${clash + 1}`; warnings.push(`${role.name}: duplicate skill title "${skill.title}", id made unique (${skill.id})`); }
    skills.push(skill);
  }
  return { levels: levels.map(({ name, jobLevel }) => ({ name, jobLevel })), skills };
}

function attachDescriptors(ws, role, parsed, warnings) {
  const h = (() => {
    for (let r = 1; r <= 5; r++) {
      const names = [];
      for (let c = 1; c <= 8; c++) names.push(cellText(ws, r, c).toLowerCase());
      if (names.includes('beginner')) return { r, names };
    }
    return null;
  })();
  if (!h) { warnings.push(`${role.name}: competencies header not found`); return; }
  const profCols = {};
  h.names.forEach((n, i) => { const p = PROFICIENCIES.find((x) => x.toLowerCase() === n); if (p) profCols[p] = i + 1; });
  // Key columns = everything left of the first proficiency column; drop the Areas column when a skill column exists.
  const firstProf = Math.min(...Object.values(profCols));
  let keyCols = Array.from({ length: firstProf - 1 }, (_, i) => i + 1);
  if (keyCols.length > 1 && h.names[0] === 'areas of expertise') keyCols = keyCols.slice(1);
  const index = new Map();
  for (const s of parsed.skills) { const k = key(s.title); index.set(k, [...(index.get(k) ?? []), s]); }
  let matched = 0, total = 0;
  for (let r = h.r + 1; r <= ws.rowCount; r++) {
    // Some tabs have a second, per-level table lower down whose cells are just labels ("Beginner", "Must Have"): not behaviour text.
    const isLabel = (v) => [...PROFICIENCIES, ...GATES].some((x) => x.toLowerCase() === v.toLowerCase());
    const descs = Object.fromEntries(Object.entries(profCols).map(([p, c]) => [p, cellText(ws, r, c)]).filter(([, v]) => v && v !== 'V2' && !isLabel(v)));
    if (!Object.keys(descs).length) continue;
    total++;
    // Try each key column; strip "Category: " prefixes (Tech Support) and take the first line only.
    const candidates = keyCols.flatMap((c) => {
      const first = splitSkill(cellText(ws, r, c)).title;
      return [first, first.includes(':') ? first.split(':').pop() : null];
    }).filter(Boolean);
    const group = candidates.map((c) => index.get(key(c))).find(Boolean);
    // Repeated titles: fill the first skill that has no descriptors yet, in sheet order.
    const skill = group && (group.find((x) => !Object.keys(x.descriptors).length) ?? group[0]);
    if (!skill) { warnings.push(`${role.name}: competencies row ${r} ("${(candidates[0] ?? '').slice(0, 40)}") has no matching skill`); continue; }
    matched++;
    Object.entries(descs).forEach(([p, text]) => { if (skill.descriptors[p]) return; skill.descriptors[p] = text.replace(/\n\s*[-•]\s*/g, '\n').replace(/^[-•]\s*/, ''); });
  }
  role.descriptorStats = { rows: total, matched };
}

const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(SRC);
const visible = new Set(wb.worksheets.filter((w) => w.state === 'visible').map((w) => w.name));
const warnings = [];
const roles = [];

for (const role of ROLES) {
  if (!visible.has(role.matrix)) { warnings.push(`${role.name}: sheet "${role.matrix}" is hidden or missing, skipped`); continue; }
  const parsed = parseMatrix(wb.getWorksheet(role.matrix), role, warnings);
  if (!parsed) continue;
  const out = { id: role.id, name: role.name, sheet: role.matrix, ...parsed };
  if (role.comps) {
    if (visible.has(role.comps)) attachDescriptors(wb.getWorksheet(role.comps), out, parsed, warnings);
    else warnings.push(`${role.name}: competencies sheet "${role.comps}" is hidden or missing`);
  }
  const noDesc = parsed.skills.filter((s) => !Object.keys(s.descriptors).length).length;
  if (noDesc) warnings.push(`${role.name}: ${noDesc}/${parsed.skills.length} skills have no behavioural descriptors`);
  roles.push(out);
}

writeFileSync(OUT, JSON.stringify({ function: 'Engineering', source: SRC, importedAt: new Date().toISOString(), roles }, null, 2));
console.log(`Wrote ${OUT}`);
for (const r of roles) {
  console.log(`- ${r.name}: ${r.levels.length} levels, ${r.skills.length} skills, descriptors ${JSON.stringify(r.descriptorStats ?? 'inline')}`);
}
console.log(`\n${warnings.length} warnings`);
warnings.forEach((w) => console.log('  !', w));
