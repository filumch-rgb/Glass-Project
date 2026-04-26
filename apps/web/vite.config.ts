import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  preview: {
    port: 4173
  },
  server: {
    host: '0.0.0.0',
    port: Number(process.env.WEB_PORT ?? 5173)
  }
});
