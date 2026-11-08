// Dev server: Bun serves index.html with hot reload; API and OAuth go to Spring on :8080 so cookies stay same-origin.
import index from '../index.html';
const API = process.env.API ?? 'http://localhost:8080';
const port = Number(process.env.PORT ?? 5173);
Bun.serve({
  port,
  development: { hmr: true, console: true },
  routes: { '/': index },
  async fetch(req) {
    const url = new URL(req.url);
    if (/^\/(api|oauth2|login|mcp|\.well-known)/.test(url.pathname)) return fetch(API + url.pathname + url.search, { method: req.method, headers: req.headers, body: req.body, redirect: 'manual' });
    const f = Bun.file('public' + url.pathname);
    return (await f.exists()) ? new Response(f) : new Response(Bun.file('index.html'));
  },
});
console.log(`dev server http://localhost:${port}`);
