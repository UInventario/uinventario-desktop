import { spawn } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const executable = join(root, 'out', 'UInventario-win32-x64', 'UInventario.exe');
const environmentArgument = process.argv.find((value) => value.startsWith('--environment=')) ?? '--environment=dev';

if (!['--environment=dev', '--environment=prod'].includes(environmentArgument)) {
  throw new Error('Desktop smoke requiere --environment=dev o --environment=prod.');
}

await stat(executable);

const child = spawn(executable, ['--smoke-test', environmentArgument], {
  cwd: dirname(executable),
  stdio: 'inherit',
  windowsHide: true,
});

child.on('error', (error) => {
  console.error(error);
  process.exitCode = 1;
});

child.on('exit', (code, signal) => {
  if (signal) {
    console.error(`Desktop smoke terminó por señal ${signal}.`);
    process.exitCode = 1;
    return;
  }

  process.exitCode = code ?? 1;
});
