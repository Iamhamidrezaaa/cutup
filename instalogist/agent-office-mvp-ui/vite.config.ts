import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';

const uiRoot = fileURLToPath(new URL('./packages/ui/src', import.meta.url));

export default defineConfig({
  plugins: [react()],
  base: './',
  server: { port: 5175 },
  resolve: {
    alias: {
      '@agent-office-ui': uiRoot
    }
  }
});
