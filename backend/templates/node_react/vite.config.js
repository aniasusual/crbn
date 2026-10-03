import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const frontendPort = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
const backendPort = process.env.BACKEND_PORT ? parseInt(process.env.BACKEND_PORT, 10) : 5001;

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [tailwindcss(), react()],
  server: {
    port: frontendPort,
    strictPort: false,
    host: '127.0.0.1',
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${backendPort}`,
        changeOrigin: true,
        secure: false,
      },
    },
  },
});
