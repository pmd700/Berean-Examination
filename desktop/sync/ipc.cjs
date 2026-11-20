'use strict';
function registerSyncHandlers({ ipcMain, appUrl, getController, readProvisioning }) {
  const origin = new URL(appUrl).origin;
  const actions = {
    status: controller => controller.status(),
    enable: async controller => { await controller.enroll(readProvisioning()); void controller.tick().catch(() => {}); return controller.status(); },
    now: controller => controller.tick(),
    invite: controller => controller.invite(),
    conflicts: controller => controller.conflicts(),
    resolve: (controller, payload) => controller.resolve(payload),
    devices: controller => controller.devices(),
    revoke: (controller, payload) => controller.revoke(payload),
    pause: (controller, payload) => controller.setPaused(payload),
  };
  for (const [action, run] of Object.entries(actions)) {
    const channel = `sync:${action}`; ipcMain.removeHandler(channel);
    ipcMain.handle(channel, async (event, payload) => {
      try {
        if (!event.senderFrame || event.senderFrame !== event.sender?.mainFrame || new URL(event.senderFrame.url).origin !== origin) throw new Error('Blocked an untrusted sync request.');
        return { ok: true, value: await run(getController(),payload) };
      } catch(error) { return { ok: false, error: error.message || 'Sync could not finish. Local edits remain saved.' }; }
    });
  }
}
module.exports = { registerSyncHandlers };
