import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const SUPPORTED_ENVIRONMENTS = new Set(['dev', 'prod']);

export function resolveEnvironment({ argv, env, isPackaged }) {
  const argument = argv.find((value) => value.startsWith('--environment='));
  const selected = argument?.slice('--environment='.length) || env.UINVENTARIO_ENV || (isPackaged ? 'prod' : 'dev');

  if (!SUPPORTED_ENVIRONMENTS.has(selected)) {
    throw new Error('El ambiente Desktop debe ser dev o prod.');
  }

  return selected;
}

export function validateWebUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('La URL Web Desktop no es válida.');
  }

  if (
    parsed.protocol !== 'https:' ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    parsed.pathname !== '/'
  ) {
    throw new Error('La URL Web Desktop debe ser un origen HTTPS sin credenciales, ruta, query ni fragmento.');
  }

  return parsed.origin;
}

export async function loadRuntimeConfig(appPath, environment) {
  const raw = await readFile(join(appPath, 'config', 'environments.json'), 'utf8');
  const environments = JSON.parse(raw);
  const configured = environments[environment];

  if (!configured || typeof configured.webUrl !== 'string') {
    throw new Error(`No existe configuración Desktop para ${environment}.`);
  }

  return Object.freeze({ environment, webUrl: validateWebUrl(configured.webUrl) });
}
