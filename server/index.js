// Local server (npm run server / npm start). On Vercel the app is exported from api/index.js instead.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { openDb } from './db.js';
import { createApp } from './app.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const api = createApp(await openDb());
const dist = path.join(ROOT, 'client', 'dist');
const app = express();
app.use(api);
if (existsSync(dist)) app.use(express.static(dist));
const port = Number(process.env.PORT ?? 3001);
app.listen(port, () => console.log(`API on http://localhost:${port}${existsSync(dist) ? ' (serving built UI)' : ''}`));
