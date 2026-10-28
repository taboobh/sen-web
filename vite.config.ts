import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base './' 讓 dist 可放在任何靜態託管的子路徑（GitHub Pages、Cloudflare Pages、Netlify 皆可）
export default defineConfig({
  base: './',
  plugins: [react()],
  test: { environment: 'node' },
})
