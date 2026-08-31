# UInventario Desktop

Cliente Windows de UInventario. Electron contiene una ventana segura que reutiliza
la aplicación Angular desplegada; no existe una segunda implementación de la UI ni
de las reglas de negocio.

El shell abre directamente Web V2 bajo `/v2/`; el origen continúa separado de la
ruta para conservar la política estricta de navegación y el aislamiento por ambiente.

## Ambientes

Los únicos orígenes aceptados se mantienen en `config/environments.json`:

- `dev`: integración continua desde `develop`.
- `prod`: última versión estable desde `master`.

El archivo sólo contiene URLs públicas. El ambiente se selecciona con
`--environment=dev|prod` o `UINVENTARIO_ENV`; un paquete usa `prod` por defecto y
una ejecución de desarrollo usa `dev`.

## Desarrollo y validación

Requiere Node.js 24 y npm 12.

```bash
npm ci
npm start
npm run verify
npm run smoke
npm run smoke:access
npm run smoke:offline
npm run smoke:prod
npm run dist:dev:test
npm run verify:dist:dev:test
```

`verify` comprueba formato, lint, pruebas y genera el paquete Windows x64. El
empaquetado usa `electron-builder`: `package:windows` crea el directorio ejecutable
y `dist:dev:test` crea un instalador NSIS versionado junto con `dev.yml` y su
blockmap. `verify:dist:dev:test` vuelve a calcular tamaño y SHA-512 desde el
instalador real. `smoke` abre ese paquete contra Dev y valida el shell real.

Cada ambiente usa una partición Chromium persistente separada. Cookies HttpOnly,
cache y IndexedDB permanecen aislados entre Dev y Prod; el Service Worker permite
arrancar el shell sin red después de una preparación online. La instantánea de sesión
Web no contiene credenciales y sólo se restaura mientras el bootstrap y los permisos
siguen vigentes. Logout o revocación limpian IndexedDB y notifican al proceso nativo
para eliminar también cookies y autenticación HTTP.

## Seguridad y superficie nativa

El renderer remoto se ejecuta sin Node.js, con aislamiento de contexto y sandbox.
La navegación se limita al origen configurado y se rechazan ventanas emergentes.
El actualizador vive por completo en el proceso principal y no expone IPC ni APIs
nativas al sitio remoto. Los futuros dispositivos se añadirán mediante puentes
mínimos y explícitos cuando una capacidad funcional los necesite.

## Distribución y actualizaciones

Los canales se mantienen separados:

- `develop` / ambiente `dev` usa el canal de actualización `dev`.
- `master` / ambiente `prod` usa el canal estable `latest`.

La aplicación no descarga ni instala silenciosamente. La opción nativa **Buscar
actualizaciones** consulta el canal, bloquea web installers, deja que
`electron-updater` verifique el SHA-512 y la firma Authenticode configurada, vuelve
a comprobar IndexedDB y sólo ofrece reiniciar cuando no existen operaciones en la
outbox y el esquema local permaneció estable. Los datos de la partición Chromium no
se eliminan durante una actualización o desinstalación.

Sin certificado, CI sólo genera artefactos efímeros llamados `TEST-UNSIGNED`; nunca
deben publicarse como una release estable. Se conservan siete días como artefactos
de GitHub Actions para probar instalación y metadatos. El build productivo falla de
forma cerrada si no encuentra las credenciales y configuración de CI requeridas:

- `WIN_CSC_LINK`: referencia segura al PFX/P12 o mecanismo equivalente.
- `WIN_CSC_KEY_PASSWORD`: password del certificado.
- `UINVENTARIO_WINDOWS_PUBLISHER`: nombre público exacto esperado del editor.

Cuando UIN-105 proporcione el certificado, `npm run dist:prod:signed` exige los tres valores,
activa `forceCodeSigning` y `verifyUpdateCodeSignature`, y
`npm run verify:dist:prod:signed` comprueba tanto SHA-512 como Authenticode. No se
guardan certificados ni passwords en el repositorio.

El rollback preferido consiste en publicar el código conocido como bueno con una
versión PATCH nueva en el mismo canal. Para una emergencia que requiera bajar la
versión, el operador genera/publica un canal firmado aislado `rollback-*` con
`node scripts/build-distribution.mjs --target=nsis --trust=signed --channel=rollback-<id>` y arranca una sola vez
con `--allow-update-rollback --update-channel=rollback-<id>`; sin ambas opciones el
downgrade se rechaza. Una outbox pendiente bloquea también el rollback.

## Ramas

- `master`: última versión estable publicada.
- `develop`: integración para el siguiente incremento.
- `feature/*`: trabajo aislado por ticket Jira.
