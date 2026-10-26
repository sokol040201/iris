const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("iris", {
  platform: process.platform,
  getSettings: () => ipcRenderer.invoke("settings:get"),
  saveSettings: (settings) => ipcRenderer.invoke("settings:save", settings),
  getStatus: () => ipcRenderer.invoke("status:get"),
  onStatus: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on("status:update", listener);
    return () => ipcRenderer.removeListener("status:update", listener);
  },
  takeBreak: () => ipcRenderer.send("break:now"),
  pause: () => ipcRenderer.send("timer:pause"),
  resume: () => ipcRenderer.send("timer:resume"),
});
