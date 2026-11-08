// Serves the built dist/ (what production serves), for browser tests and a local preview.
const port = Number(process.argv[2] ?? process.env.PORT ?? 4173);
Bun.serve({
  port,
  async fetch(req) {
    const path = decodeURIComponent(new URL(req.url).pathname);
    if (!path.includes('..')) { const f = Bun.file('dist' + (path.endsWith('/') ? path + 'index.html' : path)); if (await f.exists()) return new Response(f); }
    return new Response(Bun.file('dist/index.html'), { headers: { 'content-type': 'text/html' } });
  },
});
console.log(`serving dist on http://localhost:${port}`);
