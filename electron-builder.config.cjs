const channel = process.env.UINVENTARIO_UPDATE_CHANNEL ?? 'dev';
const artifactTrust = process.env.UINVENTARIO_ARTIFACT_TRUST ?? 'test';

if (!['dev', 'latest'].includes(channel) && !/^rollback-[a-z0-9][a-z0-9.-]*$/.test(channel)) {
  throw new Error('UINVENTARIO_UPDATE_CHANNEL debe ser dev, latest o rollback-*.');
}

if (!['test', 'signed'].includes(artifactTrust)) {
  throw new Error('UINVENTARIO_ARTIFACT_TRUST debe ser test o signed.');
}

const signed = artifactTrust === 'signed';

module.exports = {
  appId: 'com.uinventario.desktop',
  productName: 'UInventario',
  asar: true,
  directories: {
    output: `dist/${channel}-${artifactTrust}`,
  },
  files: ['src/**/*', 'config/**/*', 'package.json'],
  extraMetadata: {
    uinventarioUpdateChannel: channel,
    uinventarioArtifactTrust: artifactTrust,
  },
  artifactName: `UInventario-${channel}-${artifactTrust === 'test' ? 'TEST-UNSIGNED-' : ''}\${version}-\${arch}.\${ext}`,
  publish: [
    {
      provider: 'github',
      owner: 'UInventario',
      repo: 'uinventario-desktop',
      channel,
    },
  ],
  forceCodeSigning: signed,
  win: {
    target: [{ target: 'nsis', arch: ['x64'] }],
    verifyUpdateCodeSignature: signed,
    signtoolOptions: {
      signingHashAlgorithms: ['sha256'],
      ...(signed ? { publisherName: process.env.UINVENTARIO_WINDOWS_PUBLISHER } : {}),
    },
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    deleteAppDataOnUninstall: false,
  },
};
