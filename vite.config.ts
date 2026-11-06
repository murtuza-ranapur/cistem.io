import { defineConfig } from 'vite';
// Dev: Vite on :5173 proxies API + OAuth to Spring on :8080, so cookies stay same-origin.
export default defineConfig({
  base: '/',
  server: { proxy: { '/api': 'http://localhost:8080', '/oauth2': 'http://localhost:8080', '/login': 'http://localhost:8080' } },
});
