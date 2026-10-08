'use strict';

// Only the installed app's main frame can request a restart. The renderer
// cannot choose a program, arguments or a URL to launch.
function registerAppRestartHandler({ appUrl, ipcMain, app, schedule = setTimeout }) {
  const trustedOrigin = new URL(appUrl).origin;
  let requested = false;
  ipcMain.removeHandler('app:restart');
  ipcMain.handle('app:restart', async (event) => {
    try {
      const frame = event?.senderFrame;
      if (!frame || frame !== event.sender?.mainFrame || new URL(frame.url).origin !== trustedOrigin) {
        return { ok: false, error: 'BEX blocked a restart from an untrusted page.' };
      }
      if (requested) return { ok: true };
      // Electron preserves this instance's executable, working directory and
      // arguments, including --built. app.quit runs our normal backup and
      // database/service cleanup before the next process starts.
      app.relaunch();
      requested = true;
      schedule(() => app.quit(), 120);
      return { ok: true };
    } catch {
      return { ok: false, error: 'BEX could not prepare the restart. Please try again.' };
    }
  });
}

module.exports = { registerAppRestartHandler };
