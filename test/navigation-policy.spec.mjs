import assert from 'node:assert/strict';
import test from 'node:test';
import { isAllowedNavigation } from '../src/navigation-policy.mjs';

test('allows routes only inside the configured HTTPS origin', () => {
  const origin = 'https://app.example.com';

  assert.equal(isAllowedNavigation('https://app.example.com/login', origin), true);
  assert.equal(isAllowedNavigation('https://app.example.com/ventas?pagina=2', origin), true);
  assert.equal(isAllowedNavigation('https://evil.example.com', origin), false);
  assert.equal(isAllowedNavigation('http://app.example.com', origin), false);
  assert.equal(isAllowedNavigation('not-a-url', origin), false);
});
