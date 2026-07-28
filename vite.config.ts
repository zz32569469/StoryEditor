import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  // GitHub Pages 把網站放在 /<repo>/ 底下，資源路徑必須跟著加前綴，
  // 否則上線後所有 JS/CSS 都會 404。開發時維持根路徑，網址才不用多打一層。
  base: command === 'build' ? '/StoryEditor/' : '/',
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
}))
