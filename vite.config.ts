import basicSsl from '@vitejs/plugin-basic-ssl'
import { defineConfig } from 'vitest/config'
import { serviceWorker } from './tools/serviceWorker.ts'

export default defineConfig(({ mode }) => ({
  // Relative asset URLs, so the build runs under any path, such as GitHub Pages' /vibe-p2pgame/.
  base: './',
  // Phones only open the camera on HTTPS pages, so `pnpm dev:phone` serves with a self-signed
  // certificate that the phone has to accept once.
  plugins: [serviceWorker(), ...(mode === 'phone' ? [basicSsl()] : [])],
  test: {
    include: ['src/**/*.test.ts', 'tools/**/*.test.ts'],
  },
}))
