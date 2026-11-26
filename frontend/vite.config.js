import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,        // keep same port as before
    strictPort: true,  // fail if 3000 is taken (don't silently switch)
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        publicDashboard: resolve(__dirname, 'public-dashboard.html'),
      },
    },
  },
})

