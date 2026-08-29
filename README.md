# UInventario Desktop

Cliente Windows de UInventario. Electron contiene una ventana segura que reutiliza
la aplicación Angular desplegada; no existe una segunda implementación de la UI ni
de las reglas de negocio.

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
npm run smoke:prod
```

`verify` comprueba formato, lint, pruebas y genera el paquete Windows x64. El
empaquetado usa el layout manual soportado por Electron para evitar introducir un
árbol adicional de herramientas vulnerable: runtime oficial más `resources/app`.
`smoke` ejecuta ese paquete, abre una ventana oculta contra Dev y termina al cargar
el shell real.

## Seguridad y superficie nativa

El renderer remoto se ejecuta sin Node.js, con aislamiento de contexto y sandbox.
La navegación se limita al origen configurado y se rechazan ventanas emergentes.
Este ticket no expone IPC ni APIs nativas: almacenamiento seguro, impresión,
dispositivos y actualización se añadirán mediante puentes mínimos y explícitos
cuando una capacidad funcional los necesite.

## Ramas

- `master`: última versión estable publicada.
- `develop`: integración para el siguiente incremento.
- `feature/*`: trabajo aislado por ticket Jira.
