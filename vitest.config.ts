import { defineConfig } from 'vitest/config';

// Vitest is the unit-test runner for the Tier 2 scoring engine and
// any other PURE-TYPESCRIPT utility (rotation rules, libero state
// machine, edit/delete event-log replays, etc.). It deliberately does
// NOT pick up React Native screen/component files — those need an
// RN-aware runtime (jest-expo) which we haven't set up here. Stick
// to module-only logic in tests for now.
export default defineConfig({
  test: {
    include: ['src/**/__tests__/**/*.test.ts'],
    environment: 'node',
  },
});
