// Vercel serverless entry: the same Express app, with the database opened once per warm instance.
import { createApp } from '../server/app.js';
import { openDb } from '../server/db.js';

let ready;
export default async function handler(req, res) {
  ready ??= openDb().then((db) => createApp(db));
  const app = await ready;
  return app(req, res);
}
