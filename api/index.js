// Vercel serverless entry: the same Express app, with the database opened once per warm instance.
import { createApp } from '../server/app.js';
import { openDb } from '../server/db.js';

let ready;
export default async function handler(req, res) {
  try {
    ready ??= openDb().then((db) => createApp(db));
    const app = await ready;
    return app(req, res);
  } catch (e) {
    ready = undefined; // retry on the next request once the settings are fixed
    console.error(e);
    // These messages only name missing settings (DATABASE_URL, SESSION_SECRET...), never values.
    res.statusCode = 503;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ error: `Server is not configured yet: ${e.message}` }));
  }
}
