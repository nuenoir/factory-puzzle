import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // The app's pure logic (placement editing) is tested too; its React
    // components are verified in the browser instead.
    include: ['packages/*/tests/**/*.test.ts', 'app/**/*.test.ts'],
  },
})
