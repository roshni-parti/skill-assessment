// Usage: node scripts/import-employees.mjs path/to/Active-and-Inactive-Employee-Master.xlsx
// Writes ONLY the columns the tool needs into the `employees` table (DATABASE_URL if set, else the local dev DB).
// The master file also holds bank, DOB, address and family details: those are never read into the database.
import ExcelJS from 'exceljs';
import { openDb } from '../server/db.js';
import { upsertEmployees } from '../server/directory.js';

const file = process.argv[2];
if (!file) { console.error('Usage: node scripts/import-employees.mjs <employee-master.xlsx>'); process.exit(1); }

const COLUMNS = {
  id: 'Employee Id', name: 'Full Name', email: 'Official Email Id', status: 'Employment Status',
  parent_department: 'Parent Department Name', department: 'Current Department', designation: 'Current Designation',
  functional_title: 'Functional Title', band: 'Band', manager_id: 'Direct Manager Employee Id', manager_name: 'Direct Manager Name',
};

const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(file);
const ws = wb.getWorksheet('Data') ?? wb.worksheets[0];
const header = {};
ws.getRow(1).eachCell((c, i) => { header[String(c.value).trim()] = i; });
for (const col of Object.values(COLUMNS)) if (!header[col]) { console.error(`Column "${col}" not found in ${ws.name}`); process.exit(1); }

const cell = (row, name) => String(row.getCell(header[name]).text ?? '').trim();
const list = [];
ws.eachRow((row, n) => {
  if (n === 1) return;
  if (cell(row, COLUMNS.status) !== 'Active') return;
  const email = cell(row, COLUMNS.email);
  if (!email || !cell(row, COLUMNS.id)) return;
  list.push({
    id: cell(row, COLUMNS.id), name: cell(row, COLUMNS.name), email,
    parent_department: cell(row, COLUMNS.parent_department), department: cell(row, COLUMNS.department),
    designation: cell(row, COLUMNS.designation), functional_title: cell(row, COLUMNS.functional_title), band: cell(row, COLUMNS.band),
    manager_id: cell(row, COLUMNS.manager_id) || null, manager_name: cell(row, COLUMNS.manager_name) || null,
  });
});

const db = await openDb();
await upsertEmployees(db, list);
// People who left (or changed email) since the last import must not be able to sign in.
await db.run('DELETE FROM employees WHERE id <> ALL($1)', [list.map((e) => e.id)]);
const { n } = await db.one('SELECT count(*)::int AS n FROM employees');
console.log(`Imported ${list.length} active employees (${n} in database) from ${file}`);
process.exit(0);
