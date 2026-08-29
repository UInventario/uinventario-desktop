import assert from 'node:assert/strict';
import test from 'node:test';
import { clearOriginAccess } from '../src/access-cleanup.mjs';

test('removes every origin cookie and cached HTTP authentication on session close', async () => {
  const removed = [];
  let authCacheCleared = false;
  const browserSession = {
    cookies: {
      get: async () => [{ name: 'session' }, { name: 'csrf' }],
      remove: async (origin, name) => removed.push({ origin, name }),
    },
    clearAuthCache: async () => {
      authCacheCleared = true;
    },
  };

  await clearOriginAccess(browserSession, 'https://app.example.com');

  assert.deepEqual(removed, [
    { origin: 'https://app.example.com', name: 'session' },
    { origin: 'https://app.example.com', name: 'csrf' },
  ]);
  assert.equal(authCacheCleared, true);
});
