import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['server/**/*.test.ts', 'scripts/**/*.test.ts'],
    exclude: ['server/runtime-layout.test.ts'],
    environment: 'node',
  },
})
