import { expect, it } from 'vitest';

// Build guide 1.13 probe: a deliberately failing test must block merging. Removed afterwards.
it('fails on purpose to prove CI blocks merging', () => {
  expect(1 + 1).toBe(3);
});
