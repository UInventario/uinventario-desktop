const { ipcRenderer } = require('electron');

window.addEventListener('uinventario:session-closed', () => {
  ipcRenderer.send('uinventario:session-closed');
});
