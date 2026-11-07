import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const frontendPort = process.env.PORT
  ? parseInt(process.env.PORT, 10)
  : (process.env.VITE_PORT ? parseInt(process.env.VITE_PORT, 10) : 3000);
const backendPort = process.env.BACKEND_PORT
  ? parseInt(process.env.BACKEND_PORT, 10)
  : (process.env.VITE_BACKEND_PORT ? parseInt(process.env.VITE_BACKEND_PORT, 10) : 5001);

const degreesBadgeHtml = `
    <!-- 80degrees Platform Attribution Chip (Vite Injection Fallback) -->
    <a
      id="made-on-80degrees"
      href="https://80degrees.com"
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Built on 80degrees platform"
      title="Built with 80degrees"
    >
      <svg class="degrees-badge-logo" viewBox="0 0 512 512" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <rect width="512" height="512" rx="128" fill="#141416"/>
        <path d="M 376 310 A 154 154 0 1 1 336 142" stroke="#ffffff" stroke-width="60" stroke-linecap="round"/>
        <circle cx="424" cy="169" r="33" fill="#ffffff"/>
      </svg>
      <span class="degrees-badge-text">Made on <span class="degrees-badge-brand">80degrees</span></span>
    </a>`;

function degreesBadgePlugin() {
  return {
    name: 'vite-plugin-80degrees-badge',
    transformIndexHtml(html) {
      if (!html.includes('id="made-on-80degrees"')) {
        if (html.includes('</body>')) {
          return html.replace('</body>', `${degreesBadgeHtml}\n  </body>`);
        }
        return `${html}\n${degreesBadgeHtml}`;
      }
      return html;
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [tailwindcss(), react(), degreesBadgePlugin()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: frontendPort,
    strictPort: true,
    host: '127.0.0.1',
    allowedHosts: true,
    cors: true,
    fs: {
      strict: false,
    },
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${backendPort}`,
        changeOrigin: true,
        secure: false,
      },
    },
  },
});
