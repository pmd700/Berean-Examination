'use strict';

const CHANNELS = Object.freeze({
  chooseAsset: 'course-studio:choose-asset',
  create: 'course-studio:create',
  exportPackage: 'course-studio:export-package',
  open: 'course-studio:open',
  openRecent: 'course-studio:open-recent',
  publishBeta: 'course-studio:publish-beta',
  publishingStatus: 'course-studio:publishing-status',
  recent: 'course-studio:recent',
  save: 'course-studio:save',
  saveNow: 'course-studio:save-now',
  validate: 'course-studio:validate',
  setChannelVersion: 'course-studio:set-channel-version',
});

function trusted(event, origin) {
  const senderUrl = event?.senderFrame?.url || event?.sender?.getURL?.() || '';
  try {
    if (new URL(senderUrl).origin === origin) return;
  } catch {}
  const error = new Error('Course Studio blocked an untrusted request.');
  error.code = 'BEX_UNTRUSTED_SENDER';
  throw error;
}

function response(error, fallback) {
  const known = {
    BEX_STUDIO_ASSET_INVALID: 'Choose a finished MP4 video, WebVTT caption, or JPG, PNG, or WebP image.',
    BEX_STUDIO_EXISTS: 'That folder already contains a Course Studio project. Open it instead.',
    BEX_STUDIO_INVALID: 'That Course Studio project is invalid.',
    BEX_STUDIO_NOT_OPEN: 'Open that Course Studio project before saving.',
    BEX_STUDIO_UNSUPPORTED: 'That project needs a newer Course Studio version.',
    BEX_UNTRUSTED_SENDER: 'Course Studio blocked a request from an untrusted page.',
  };
  return { ok: false, error: known[error?.code] || fallback };
}

function registerCourseStudioHandlers({ appUrl, chooseAsset, chooseCatalogFolder, chooseExportFolder, chooseProjectFolder, exportProject, ipcMain, projectStore, publishBeta, publishingStatus, setChannelVersion, validateProject }) {
  const origin = new URL(appUrl).origin;
  Object.values(CHANNELS).forEach((channel) => ipcMain.removeHandler(channel));
  ipcMain.removeAllListeners(CHANNELS.saveNow);

  ipcMain.handle(CHANNELS.recent, async (event) => {
    try { trusted(event, origin); return { ok: true, projects: projectStore.recent() }; }
    catch (error) { return response(error, 'Recent Course Studio projects could not be read.'); }
  });
  ipcMain.handle(CHANNELS.create, async (event) => {
    try {
      trusted(event, origin);
      const folder = await chooseProjectFolder('create');
      return folder ? { ok: true, project: projectStore.create(folder) } : { ok: true, canceled: true };
    } catch (error) { return response(error, 'Course Studio could not create that project.'); }
  });
  ipcMain.handle(CHANNELS.open, async (event) => {
    try {
      trusted(event, origin);
      const folder = await chooseProjectFolder('open');
      return folder ? { ok: true, project: projectStore.open(folder) } : { ok: true, canceled: true };
    } catch (error) { return response(error, 'Course Studio could not open that project.'); }
  });
  ipcMain.handle(CHANNELS.openRecent, async (event, folder) => {
    try { trusted(event, origin); return { ok: true, project: projectStore.open(folder) }; }
    catch (error) { return response(error, 'Course Studio could not reopen that project.'); }
  });
  ipcMain.handle(CHANNELS.save, async (event, project) => {
    try { trusted(event, origin); return { ok: true, project: projectStore.save(project) }; }
    catch (error) { return response(error, 'Course Studio could not save that project.'); }
  });
  ipcMain.on(CHANNELS.saveNow, (event, project) => {
    try { trusted(event, origin); event.returnValue = { ok: true, project: projectStore.save(project) }; }
    catch (error) { event.returnValue = response(error, 'Course Studio could not finish saving that project.'); }
  });
  ipcMain.handle(CHANNELS.chooseAsset, async (event, projectId, kind) => {
    try {
      trusted(event, origin);
      const filePath = await chooseAsset(kind);
      return filePath ? { ok: true, asset: projectStore.describeAsset(projectId, kind, filePath) } : { ok: true, canceled: true };
    } catch (error) { return response(error, 'Course Studio could not use that file.'); }
  });
  ipcMain.handle(CHANNELS.validate, async (event, project) => {
    try { trusted(event, origin); return { ok: true, validation: validateProject(project) }; }
    catch (error) { return response(error, 'Course Studio could not validate that project.'); }
  });
  ipcMain.handle(CHANNELS.exportPackage, async (event, project) => {
    try {
      trusted(event, origin);
      const saved = projectStore.save(project);
      const validation = validateProject(saved);
      if (!validation.valid) return { ok: true, validation };
      const destination = await chooseExportFolder();
      if (!destination) return { ok: true, canceled: true, validation };
      return { ok: true, exported: await exportProject(saved, destination), validation };
    } catch (error) { return response(error, error?.message || 'Course Studio could not export that package.'); }
  });
  ipcMain.handle(CHANNELS.publishBeta, async (event, packageFolder, catalogFolder) => {
    try {
      trusted(event, origin);
      const folder = catalogFolder || await chooseCatalogFolder();
      if (!folder) return { ok: true, canceled: true };
      return { ok: true, publication: await publishBeta(packageFolder, folder) };
    } catch (error) { return response(error, error?.message || 'Course Studio could not publish that Beta.'); }
  });
  ipcMain.handle(CHANNELS.publishingStatus, async (event, catalogFolder, courseId) => {
    try { trusted(event, origin); return { ok: true, status: await publishingStatus(catalogFolder, courseId) }; }
    catch (error) { return response(error, error?.message || 'Course Studio could not read local publishing status.'); }
  });
  ipcMain.handle(CHANNELS.setChannelVersion, async (event, catalogFolder, courseId, version, channel) => {
    try { trusted(event, origin); return { ok: true, publication: await setChannelVersion(catalogFolder, courseId, version, channel) }; }
    catch (error) { return response(error, error?.message || 'Course Studio could not change that catalog version.'); }
  });
}

module.exports = { CHANNELS, registerCourseStudioHandlers };
