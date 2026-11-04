import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// `npm run dev:web` serves the app on :5173 and proxies the API to the Node server (`npm run dev`, PORT 8099 in dev).
const api = process.env.CTC_API || 'http://localhost:8099';

export default defineConfig({
  root: import.meta.dirname,
  plugins: [react()],
  server: { port: 5173, proxy: { '/api': api, '/mcp': api, '/static': api } },
  build: { outDir: 'dist', emptyOutDir: true, sourcemap: false, chunkSizeWarningLimit: 700 }
});
