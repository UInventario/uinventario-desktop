import { spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const options = Object.fromEntries(
  process.argv.slice(2).map((argument) => {
    const [key, value] = argument.replace(/^--/, '').split('=', 2);
    return [key, value];
  }),
);
const target = options.target;
const trust = options.trust;
const channel = options.channel;

if (!['dir', 'nsis'].includes(target)) throw new Error('El target debe ser dir o nsis.');
if (!['test', 'signed'].includes(trust)) throw new Error('La confianza debe ser test o signed.');
if (!['dev', 'latest'].includes(channel) && !/^rollback-[a-z0-9][a-z0-9.-]*$/.test(channel)) {
  throw new Error('El canal debe ser dev, latest o rollback-*.');
}

if (
  trust === 'signed' &&
  (!(process.env.WIN_CSC_LINK || process.env.CSC_LINK) ||
    !(process.env.WIN_CSC_KEY_PASSWORD || process.env.CSC_KEY_PASSWORD))
) {
  throw new Error('La distribución firmada requiere WIN_CSC_LINK/WIN_CSC_KEY_PASSWORD o sus equivalentes CSC en CI.');
}
if (trust === 'signed' && !process.env.UINVENTARIO_WINDOWS_PUBLISHER) {
  throw new Error('La distribución firmada requiere UINVENTARIO_WINDOWS_PUBLISHER con el editor esperado.');
}

const builderCli = join(root, 'node_modules', 'electron-builder', 'out', 'cli', 'cli.js');
const child = spawn(
  process.execPath,
  [builderCli, '--config', 'electron-builder.config.cjs', '--win', target, '--x64', '--publish', 'never'],
  {
    cwd: root,
    stdio: 'inherit',
    env: {
      ...process.env,
      CSC_IDENTITY_AUTO_DISCOVERY: trust === 'signed' ? 'true' : 'false',
      UINVENTARIO_ARTIFACT_TRUST: trust,
      UINVENTARIO_UPDATE_CHANNEL: channel,
    },
  },
);

child.on('error', (error) => {
  console.error(error);
  process.exitCode = 1;
});

child.on('exit', (code, signal) => {
  if (signal) {
    console.error(`electron-builder terminó por señal ${signal}.`);
    process.exitCode = 1;
    return;
  }
  process.exitCode = code ?? 1;
});
