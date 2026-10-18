// Vercel serverless entry: the same Express app, with the database opened once per warm instance.
// Everything is imported inside the try/catch so a failure while loading (missing file, bad dependency,
// missing setting) comes back as readable JSON instead of Vercel's bare 500 page.
let ready;
export default async function handler(req, res) {
  try {
    ready ??= (async () => {
      const [{ createApp }, { openDb }] = await Promise.all([import('../server/app.js'), import('../server/db.js')]);
      return createApp(await openDb());
    })();
    const app = await ready;
    return app(req, res);
  } catch (e) {
    ready = undefined; // retry on the next request once the problem is fixed
    console.error('startup failed:', e);
    // Messages only name missing settings or files (DATABASE_URL, SESSION_SECRET, level-map.json...), never values.
    res.statusCode = 503;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ error: `Server failed to start: ${String(e.message).replace(/postgres(ql)?:\/\/\S+/g, '[database url]').slice(0, 300)}` }));
  }
}
