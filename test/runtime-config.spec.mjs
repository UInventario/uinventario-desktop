import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { desktopPartition, loadRuntimeConfig, resolveEnvironment, validateWebUrl } from '../src/runtime-config.mjs';

test('uses dev locally and prod for a packaged application', () => {
  assert.equal(resolveEnvironment({ argv: [], env: {}, isPackaged: false }), 'dev');
  assert.equal(resolveEnvironment({ argv: [], env: {}, isPackaged: true }), 'prod');
});

test('isolates persistent Chromium storage by environment', () => {
  assert.equal(desktopPartition('dev'), 'persist:uinventario-dev-v1');
  assert.equal(desktopPartition('prod'), 'persist:uinventario-prod-v1');
  assert.throws(() => desktopPartition('local'));
});

test('explicit argument has precedence and invalid environments fail closed', () => {
  assert.equal(
    resolveEnvironment({ argv: ['--environment=prod'], env: { UINVENTARIO_ENV: 'dev' }, isPackaged: false }),
    'prod',
  );
  assert.throws(
    () => resolveEnvironment({ argv: ['--environment=local'], env: {}, isPackaged: false }),
    /debe ser dev o prod/,
  );
});

test('accepts only a clean HTTPS origin', () => {
  assert.equal(validateWebUrl('https://app.example.com'), 'https://app.example.com');
  for (const unsafe of [
    'http://app.example.com',
    'https://user:secret@app.example.com',
    'https://app.example.com/path',
    'https://app.example.com?token=secret',
  ]) {
    assert.throws(() => validateWebUrl(unsafe));
  }
});

test('loads the selected environment from the packaged configuration', async () => {
  const root = await mkdtemp(join(tmpdir(), 'uinventario-desktop-'));
  await mkdir(join(root, 'config'));
  await writeFile(
    join(root, 'config', 'environments.json'),
    JSON.stringify({
      dev: { webUrl: 'https://dev.example.com', updateChannel: 'dev' },
      prod: { webUrl: 'https://prod.example.com', updateChannel: 'latest' },
    }),
  );

  assert.deepEqual(await loadRuntimeConfig(root, 'dev'), {
    environment: 'dev',
    webUrl: 'https://dev.example.com',
    updateChannel: 'dev',
  });
});
