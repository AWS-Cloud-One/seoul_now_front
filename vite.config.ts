import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const port = Number(env.FRONTEND_PORT?.trim() || '5173')
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('FRONTEND_PORT는 1~65535 사이의 정수여야 합니다.')
  }
  const proxy = {
    '/api': {
      target: env.API_PROXY_TARGET || 'http://127.0.0.1:8000',
      changeOrigin: true,
    },
  }

  return {
    plugins: [react(), tailwindcss()],
    resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
    build: {
      rollupOptions: {
        input: {
          main: fileURLToPath(new URL('./index.html', import.meta.url)),
          developer: fileURLToPath(new URL('./developer.html', import.meta.url)),
        },
      },
    },
    server: {
      host: '127.0.0.1',
      port,
      strictPort: true,
      proxy,
    },
    preview: { host: '127.0.0.1', port, strictPort: true, proxy },
  }
})
