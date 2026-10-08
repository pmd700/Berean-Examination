import {
  createEmptyCourseLibrary,
  normalizeCourseLibrary,
} from '@/features/courses/courseLibraryModel';

export async function readCourseLibrary() {
  const desktopApi = typeof window === 'undefined' ? null : window.bexDesktop;

  // The Courses UI is intentionally able to render its honest empty state in
  // browser previews. Production Electron builds will use the narrow desktop
  // bridge added with the course database phase.
  if (!desktopApi?.isDesktop || typeof desktopApi.listCourses !== 'function') {
    return createEmptyCourseLibrary();
  }

  const result = await desktopApi.listCourses();
  if (!result?.ok) {
    throw new Error(result?.error || 'BEX could not read the local course library.');
  }
  return normalizeCourseLibrary(result.library);
}

export async function chooseAndInstallCoursePackage() {
  const desktopApi = typeof window === 'undefined' ? null : window.bexDesktop;
  if (!desktopApi?.isDesktop || typeof desktopApi.installCoursePackage !== 'function') {
    throw new Error('Course packages can be installed from the BEX desktop app.');
  }
  const result = await desktopApi.installCoursePackage();
  if (!result?.ok) {
    throw new Error(result?.error || 'BEX could not install that Course package.');
  }
  return result;
}

export async function connectLocalCourseCatalog() {
  const desktopApi = typeof window === 'undefined' ? null : window.bexDesktop;
  if (!desktopApi?.isDesktop || typeof desktopApi.connectLocalCourseCatalog !== 'function') {
    throw new Error('The test catalog can be connected from the BEX desktop app.');
  }
  const result = await desktopApi.connectLocalCourseCatalog();
  if (!result?.ok) throw new Error(result?.error || 'BEX could not connect that local Course catalog.');
  return result;
}

export async function installCourseFromCatalog(courseId) {
  const desktopApi = typeof window === 'undefined' ? null : window.bexDesktop;
  if (!desktopApi?.isDesktop || typeof desktopApi.installCatalogCourse !== 'function') {
    throw new Error('Catalog courses can be installed from the BEX desktop app.');
  }
  const result = await desktopApi.installCatalogCourse(courseId);
  if (!result?.ok) throw new Error(result?.error || 'BEX could not install that Course.');
  return result;
}

export async function pauseCourseDownload(courseId) {
  const desktopApi = typeof window === 'undefined' ? null : window.bexDesktop;
  if (!desktopApi?.isDesktop || typeof desktopApi.cancelCatalogCourse !== 'function') return { paused: false };
  const result = await desktopApi.cancelCatalogCourse(courseId);
  if (!result?.ok) throw new Error(result?.error || 'BEX could not pause that Course download.');
  return result;
}

export function onCourseDownloadProgress(callback) {
  const desktopApi = typeof window === 'undefined' ? null : window.bexDesktop;
  return typeof desktopApi?.onCourseDownloadProgress === 'function'
    ? desktopApi.onCourseDownloadProgress(callback)
    : () => {};
}

export async function saveCourseLessonProgress(courseId, lessonId, progress) {
  const desktopApi = typeof window === 'undefined' ? null : window.bexDesktop;
  if (!desktopApi?.isDesktop || typeof desktopApi.saveCourseProgress !== 'function') {
    throw new Error('Course progress is available in the BEX desktop app.');
  }
  const result = await desktopApi.saveCourseProgress(courseId, lessonId, progress);
  if (!result?.ok) {
    throw new Error(result?.error || 'BEX could not save that lesson progress.');
  }
  return result.progress;
}
