import { cp, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputRoot = join(root, 'out');
const destination = join(outputRoot, 'UInventario-win32-x64');
const electronRuntime = join(root, 'node_modules', 'electron', 'dist');

if (process.platform !== 'win32' || process.arch !== 'x64') {
  throw new Error('El paquete inicial Desktop sólo se genera en Windows x64.');
}

if (!destination.startsWith(`${outputRoot}${sep}`)) {
  throw new Error('La salida Desktop debe permanecer dentro de out/.');
}

await stat(join(electronRuntime, 'electron.exe'));
await rm(destination, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });
await cp(electronRuntime, destination, { recursive: true });

const resources = join(destination, 'resources');
const application = join(resources, 'app');
await rm(join(resources, 'default_app.asar'), { force: true });
await mkdir(application, { recursive: true });
await cp(join(root, 'config'), join(application, 'config'), { recursive: true });
await cp(join(root, 'src'), join(application, 'src'), { recursive: true });

const rootPackage = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
await writeFile(
  join(application, 'package.json'),
  `${JSON.stringify(
    {
      name: rootPackage.name,
      productName: rootPackage.productName,
      version: rootPackage.version,
      type: rootPackage.type,
      main: rootPackage.main,
    },
    null,
    2,
  )}\n`,
);

await rename(join(destination, 'electron.exe'), join(destination, 'UInventario.exe'));
await stat(join(destination, 'UInventario.exe'));
await stat(join(application, 'src', 'main.mjs'));
await stat(join(application, 'config', 'environments.json'));

console.log(`Paquete Desktop creado: ${destination}`);
