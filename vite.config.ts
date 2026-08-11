import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Electron 은 file:// 로 로드하므로 상대 경로 자산이 필요하다.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    port: 5273,
    strictPort: true,
  },
})
