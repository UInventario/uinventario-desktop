import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const options = Object.fromEntries(
  process.argv.slice(2).map((argument) => {
    const [key, value] = argument.replace(/^--/, '').split('=', 2);
    return [key, value];
  }),
);
const trust = options.trust;
const channel = options.channel;

if (!['test', 'signed'].includes(trust)) throw new Error('La confianza debe ser test o signed.');
if (!['dev', 'latest'].includes(channel) && !/^rollback-[a-z0-9][a-z0-9.-]*$/.test(channel)) {
  throw new Error('El canal debe ser dev, latest o rollback-*.');
}
if (trust === 'signed' && !process.env.UINVENTARIO_WINDOWS_PUBLISHER) {
  throw new Error('La verificación firmada requiere UINVENTARIO_WINDOWS_PUBLISHER.');
}

const output = join(root, 'dist', `${channel}-${trust}`);
const metadataPath = join(output, `${channel}.yml`);
const metadata = await readFile(metadataPath, 'utf8');

function requiredValue(pattern, field) {
  const value = metadata
    .match(pattern)?.[1]
    ?.trim()
    .replace(/^['"]|['"]$/g, '');
  if (!value) throw new Error(`Los metadatos no contienen ${field}.`);
  return value;
}

const artifactName = decodeURIComponent(requiredValue(/^\s*-?\s*url:\s*(.+)$/m, 'files[].url'));
const expectedSha512 = requiredValue(/^\s*sha512:\s*(.+)$/m, 'files[].sha512');
const expectedSize = Number(requiredValue(/^\s*size:\s*(\d+)$/m, 'files[].size'));
const artifactPath = resolve(output, artifactName);

if (!artifactPath.startsWith(`${resolve(output)}${sep}`)) {
  throw new Error('La ruta del artefacto salió del directorio de distribución.');
}

const artifactStat = await stat(artifactPath);
if (artifactStat.size !== expectedSize) {
  throw new Error(`El tamaño no coincide: esperado ${expectedSize}, obtenido ${artifactStat.size}.`);
}

const hash = createHash('sha512');
for await (const chunk of createReadStream(artifactPath)) hash.update(chunk);
const actualSha512 = hash.digest('base64');
if (actualSha512 !== expectedSha512) {
  throw new Error('El SHA-512 del instalador no coincide con el manifiesto de actualización.');
}

if (trust === 'test') {
  if (!artifactName.includes('TEST-UNSIGNED')) {
    throw new Error('Un artefacto sin firma debe estar marcado inequívocamente como TEST-UNSIGNED.');
  }
} else {
  await new Promise((resolvePromise, reject) => {
    const command =
      '$signature = Get-AuthenticodeSignature -LiteralPath $env:UINVENTARIO_ARTIFACT; ' +
      "if ($signature.Status -ne 'Valid') { Write-Error ('Firma Authenticode inválida: ' + $signature.Status); exit 1 }; " +
      "if ($signature.SignerCertificate.Subject -notmatch [regex]::Escape($env:UINVENTARIO_WINDOWS_PUBLISHER)) { Write-Error 'El publisher no coincide'; exit 1 }; " +
      "Write-Output 'Firma Authenticode y publisher verificados.'";
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
      stdio: 'inherit',
      windowsHide: true,
      env: { ...process.env, UINVENTARIO_ARTIFACT: artifactPath },
    });
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0 ? resolvePromise() : reject(new Error('La firma Authenticode no es válida.')),
    );
  });
}

console.log(`Artefacto ${channel}/${trust} verificado: ${artifactName} (${artifactStat.size} bytes).`);
