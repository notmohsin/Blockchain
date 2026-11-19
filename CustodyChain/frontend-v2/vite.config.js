import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

// Dev server proxies the API (gateway-v2 on :4000); `npm run build` output is served by gateway-v2 itself.
export default defineConfig({
  plugins: [svelte()],
  server: { port: 5174, proxy: { '/api': 'http://localhost:4000' } },
});
