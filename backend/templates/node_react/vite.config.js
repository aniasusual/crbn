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
    <!-- 80degrees Platform Attribution Chip -->
    <style id="made-on-80degrees-style">
      #made-on-80degrees {
        position: fixed !important;
        bottom: 16px !important;
        right: 16px !important;
        z-index: 2147483647 !important;
        display: inline-flex !important;
        align-items: center !important;
        gap: 6px !important;
        margin: 0 !important;
        padding: 6px 12px 6px 10px !important;
        background-color: rgba(17, 17, 19, 0.92) !important;
        backdrop-filter: blur(12px) !important;
        -webkit-backdrop-filter: blur(12px) !important;
        border: none !important;
        outline: none !important;
        border-radius: 9999px !important;
        box-shadow: 0 6px 18px rgba(0, 0, 0, 0.22), 0 1px 3px rgba(0, 0, 0, 0.18) !important;
        text-decoration: none !important;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Plus Jakarta Sans", sans-serif !important;
        font-size: 11.5px !important;
        font-weight: 500 !important;
        line-height: 1 !important;
        color: rgba(255, 255, 255, 0.72) !important;
        cursor: pointer !important;
        transition: transform 0.15s ease, background-color 0.15s ease, box-shadow 0.15s ease, color 0.15s ease !important;
        user-select: none !important;
        -webkit-user-select: none !important;
        pointer-events: auto !important;
        box-sizing: border-box !important;
      }
      #made-on-80degrees:hover {
        background-color: rgba(26, 26, 30, 0.96) !important;
        color: #ffffff !important;
        transform: translateY(-1px) !important;
        box-shadow: 0 10px 24px rgba(0, 0, 0, 0.28), 0 2px 4px rgba(0, 0, 0, 0.18) !important;
      }
      #made-on-80degrees:focus-visible {
        outline: 2px solid #B2451F !important;
        outline-offset: 2px !important;
      }
      #made-on-80degrees .degrees-badge-logo {
        width: 15px !important;
        height: 15px !important;
        display: block !important;
        flex-shrink: 0 !important;
      }
      #made-on-80degrees .degrees-badge-text {
        display: inline-block !important;
        white-space: nowrap !important;
      }
      #made-on-80degrees .degrees-badge-brand {
        font-weight: 600 !important;
        color: #ffffff !important;
        letter-spacing: -0.01em !important;
      }
      @media (max-width: 480px) {
        #made-on-80degrees {
          bottom: 10px !important;
          right: 10px !important;
          padding: 5px 10px 5px 8px !important;
          font-size: 11px !important;
        }
        #made-on-80degrees .degrees-badge-logo {
          width: 14px !important;
          height: 14px !important;
        }
      }
      @media print {
        #made-on-80degrees {
          display: none !important;
        }
      }
    </style>
    <a
      id="made-on-80degrees"
      href="https://80degrees.dev"
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Made on 80degrees"
    >
      <svg class="degrees-badge-logo" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" fill="none" aria-hidden="true">
        <path d="M 376 310 A 154 154 0 1 1 336 142" stroke="#B2451F" stroke-width="60" stroke-linecap="round" />
        <circle cx="424" cy="169" r="33" fill="#B2451F" />
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
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${backendPort}`,
        changeOrigin: true,
        secure: false,
      },
    },
  },
});
