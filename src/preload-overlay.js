const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("overlay", {
  skip: () => ipcRenderer.send("overlay:skip"),
  onStart: (callback) => {
    ipcRenderer.on("overlay:start", (_event, payload) => callback(payload));
  },
});
