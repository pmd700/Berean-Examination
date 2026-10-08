'use strict';

const COURSE_CHANNELS = Object.freeze({
  cancelCatalogCourse: 'courses:cancel-catalog-course',
  connectCatalog: 'courses:connect-local-catalog',
  installCatalogCourse: 'courses:install-catalog-course',
  installPackage: 'courses:install-package',
  list: 'courses:list',
  saveProgress: 'courses:save-progress',
});
const COURSE_DOWNLOAD_PROGRESS_CHANNEL = 'courses:download-progress';

const PUBLIC_ERROR_MESSAGES = Object.freeze({
  BEX_COURSE_INVALID: 'That course progress could not be saved.',
  BEX_COURSE_CATALOG_INVALID: 'That folder is not a valid BEX Course catalog.',
  BEX_COURSE_CATALOG_SIGNATURE_INVALID: 'That Course catalog did not pass its authenticity check.',
  BEX_COURSE_APP_UPDATE_REQUIRED: 'Update BEX before installing that Course package.',
  BEX_COURSE_ASSET_MISMATCH: 'A Course file was changed or damaged. Nothing was installed.',
  BEX_COURSE_ASSET_MISSING: 'A required Course file is missing. Nothing was installed.',
  BEX_COURSE_DISK_FULL: 'There is not enough free space to install that course.',
  BEX_COURSE_DOWNLOAD_ACTIVE: 'That Course is already downloading.',
  BEX_COURSE_DOWNLOAD_STATE_INVALID: 'BEX found damaged Course download progress. Nothing was installed.',
  BEX_COURSE_MANIFEST_INVALID: 'That folder is not a valid BEX Course package.',
  BEX_COURSE_MANIFEST_UNSUPPORTED: 'That Course package needs a newer BEX version.',
  BEX_COURSE_NOT_FOUND: 'That installed course lesson could not be found.',
  BEX_COURSE_PACKAGE_INVALID: 'That folder is not a valid BEX Course package.',
  BEX_COURSE_SIGNATURE_INVALID: 'That Course package did not pass its authenticity check.',
  BEX_COURSE_SIGNATURE_REQUIRED: 'Release builds accept only Course packages signed by David.',
  BEX_COURSE_SIGNATURE_UNVERIFIED: 'BEX cannot verify that signed Course package yet.',
  BEX_COURSE_VERSION_CONFLICT: 'That course version already exists and cannot be silently changed.',
  BEX_DATABASE_NOT_OPEN: 'Choose or reconnect the Berean Library before opening Courses.',
  BEX_PRIVACY_LOCKED: 'Unlock the Berean Library before opening Courses.',
  BEX_PRIVACY_NOT_OPEN: 'Unlock the Berean Library before opening Courses.',
  BEX_UNTRUSTED_SENDER: 'BEX blocked a request from an untrusted page.',
});

function codedError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function assertTrustedSender(event, trustedOrigin) {
  const senderUrl = event?.senderFrame?.url
    || (event?.sender && typeof event.sender.getURL === 'function' ? event.sender.getURL() : '');
  let senderOrigin = null;
  try {
    senderOrigin = new URL(senderUrl).origin;
  } catch {
    // A malformed sender URL is never trusted.
  }
  if (senderOrigin !== trustedOrigin) {
    throw codedError('BEX_UNTRUSTED_SENDER', 'Blocked a Course request from an untrusted page.');
  }
}

function errorResponse(error, fallbackMessage) {
  const publicMessage = error && typeof error.code === 'string'
    ? PUBLIC_ERROR_MESSAGES[error.code]
    : null;
  return { ok: false, error: publicMessage || fallbackMessage };
}

function validateDependencies(options) {
  if (!options || typeof options.appUrl !== 'string') {
    throw new TypeError('The Course bridge requires the BEX application URL.');
  }
  if (
    !options.ipcMain
    || typeof options.ipcMain.handle !== 'function'
    || typeof options.ipcMain.removeHandler !== 'function'
  ) {
    throw new TypeError('The Course bridge requires Electron IPC.');
  }
  for (const dependency of [
    'connectLocalCourseCatalog',
    'cancelCatalogCourse',
    'chooseAndInstallCoursePackage',
    'installCatalogCourse',
    'listCourseLibrary',
    'saveCourseProgress',
  ]) {
    if (typeof options[dependency] !== 'function') {
      throw new TypeError('The Course bridge is missing ' + dependency + '.');
    }
  }
}

function registerCourseHandlers(options) {
  validateDependencies(options);
  const {
    appUrl,
    chooseAndInstallCoursePackage,
    cancelCatalogCourse,
    connectLocalCourseCatalog,
    installCatalogCourse,
    ipcMain,
    listCourseLibrary,
    saveCourseProgress,
  } = options;
  const trustedOrigin = new URL(appUrl).origin;

  for (const channel of Object.values(COURSE_CHANNELS)) {
    ipcMain.removeHandler(channel);
  }

  ipcMain.handle(COURSE_CHANNELS.installPackage, async (event) => {
    try {
      assertTrustedSender(event, trustedOrigin);
      return { ok: true, ...(await chooseAndInstallCoursePackage()) };
    } catch (error) {
      return errorResponse(error, 'BEX could not install that Course package. Nothing was removed.');
    }
  });

  ipcMain.handle(COURSE_CHANNELS.connectCatalog, async (event) => {
    try {
      assertTrustedSender(event, trustedOrigin);
      return { ok: true, ...(await connectLocalCourseCatalog()) };
    } catch (error) {
      return errorResponse(error, 'BEX could not connect that local Course catalog.');
    }
  });

  ipcMain.handle(COURSE_CHANNELS.cancelCatalogCourse, async (event, courseId) => {
    try {
      assertTrustedSender(event, trustedOrigin);
      return { ok: true, ...(await cancelCatalogCourse(courseId)) };
    } catch (error) {
      return errorResponse(error, 'BEX could not pause that Course download.');
    }
  });

  ipcMain.handle(COURSE_CHANNELS.installCatalogCourse, async (event, courseId) => {
    try {
      assertTrustedSender(event, trustedOrigin);
      return { ok: true, ...(await installCatalogCourse(courseId)) };
    } catch (error) {
      return errorResponse(error, 'BEX could not install that Course from the local catalog.');
    }
  });

  ipcMain.handle(COURSE_CHANNELS.list, async (event) => {
    try {
      assertTrustedSender(event, trustedOrigin);
      return { ok: true, library: await listCourseLibrary() };
    } catch (error) {
      return errorResponse(error, 'BEX could not read the local course library.');
    }
  });

  ipcMain.handle(COURSE_CHANNELS.saveProgress, async (event, courseId, lessonId, progress) => {
    try {
      assertTrustedSender(event, trustedOrigin);
      return {
        ok: true,
        progress: await saveCourseProgress(courseId, lessonId, progress),
      };
    } catch (error) {
      return errorResponse(error, 'BEX could not save that lesson progress.');
    }
  });
}

module.exports = {
  COURSE_CHANNELS,
  COURSE_DOWNLOAD_PROGRESS_CHANNEL,
  registerCourseHandlers,
};
