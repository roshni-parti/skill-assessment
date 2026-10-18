# Level Readiness

Self-assessment + direct-manager review against the next level of the Engineering skill matrix.
Output: readiness score /100, gap analysis, scenario check, recommendations.

- **Deploying / running:** see [DEPLOY.md](DEPLOY.md) (GitHub, Neon database, Google sign-in, Vercel).
- **Data:** `data/matrix.json` (skill matrix, built from the Engineering workbook with `npm run import`),
  `data/scenarios.json` (scenario questions, need SME review), `data/level-map.json` (department/band -> role/level).
  Employee data is loaded into the database only (`npm run import:employees`); the master file is never committed.
- **Scoring:** gate-weighted average of min(rating / target, 1). Must Have 3, Should Have 2, Good to Have 1, no gate 2.
  A scenario answer is 50% of the self figure for that skill. With a manager review each skill is 40% self, 60% manager.
  Bands: <50 Early, 50-74 Developing, 75+ Ready ("Almost ready" while any Must Have gap remains).
- **Access:** Google sign-in (@rapido.bike, must be an active employee). Everyone gets their own role/level/manager from the
  employee master. Admins (roshni.parti@rapido.bike + `ADMIN_EMAILS`) also get the quick demo, manual picker and "take the test
  as another employee"; those runs are stored as tests and never appear for the real employee or manager.
- **Code map:** `server/app.js` API, `server/directory.js` level/manager derivation, `server/auth.js` sessions + Google verify,
  `server/db.js` Postgres (Neon in production, embedded PGlite locally), `server/scoring.js`, `api/index.js` Vercel entry.
