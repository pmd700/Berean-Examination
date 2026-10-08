export const COURSE_INSTALL_STATES = Object.freeze({
  AVAILABLE: 'available',
  DOWNLOADING: 'downloading',
  INSTALLED: 'installed',
  UPDATE_AVAILABLE: 'update_available',
});

const VALID_INSTALL_STATES = new Set(Object.values(COURSE_INSTALL_STATES));

function cleanString(value, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function finiteNumber(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function normalizeLesson(lesson, moduleId, position) {
  const id = cleanString(lesson?.id, moduleId + '-lesson-' + position);
  const durationSeconds = Math.max(0, finiteNumber(lesson?.durationSeconds));
  const progressSeconds = Math.min(
    durationSeconds || Number.MAX_SAFE_INTEGER,
    Math.max(0, finiteNumber(lesson?.progressSeconds)),
  );

  return {
    id,
    title: cleanString(lesson?.title, 'Untitled lesson'),
    description: cleanString(lesson?.description),
    durationSeconds,
    progressSeconds,
    completed: Boolean(lesson?.completed),
    mediaUrl: cleanString(lesson?.mediaUrl),
    mediaMimeType: cleanString(lesson?.mediaMimeType),
    posterUrl: cleanString(lesson?.posterUrl),
    captions: Array.isArray(lesson?.captions)
      ? lesson.captions.map((caption, index) => ({
          id: cleanString(caption?.id, id + '-caption-' + index),
          url: cleanString(caption?.url),
          label: cleanString(caption?.label, 'Captions'),
          language: cleanString(caption?.language, 'en'),
          mimeType: cleanString(caption?.mimeType, 'text/vtt'),
        })).filter((caption) => caption.url)
      : [],
    position,
  };
}

function normalizeModule(module, courseId, position) {
  const id = cleanString(module?.id, courseId + '-module-' + position);
  const lessons = Array.isArray(module?.lessons)
    ? module.lessons.map((lesson, index) => normalizeLesson(lesson, id, index))
    : [];

  return {
    id,
    title: cleanString(module?.title, 'Untitled module'),
    description: cleanString(module?.description),
    position,
    lessons,
  };
}

export function normalizeCourse(course, position = 0) {
  const id = cleanString(course?.id, 'course-' + position);
  const modules = Array.isArray(course?.modules)
    ? course.modules.map((module, index) => normalizeModule(module, id, index))
    : [];
  const lessons = modules.flatMap((module) => module.lessons);
  const completedLessons = lessons.filter((lesson) => lesson.completed).length;
  const suppliedProgress = finiteNumber(course?.progressPercent, -1);
  const progressPercent = suppliedProgress >= 0
    ? Math.min(100, Math.max(0, suppliedProgress))
    : lessons.length
      ? Math.round((completedLessons / lessons.length) * 100)
      : 0;
  const installState = VALID_INSTALL_STATES.has(course?.installState)
    ? course.installState
    : COURSE_INSTALL_STATES.AVAILABLE;

  return {
    id,
    version: cleanString(course?.version, '1.0.0'),
    title: cleanString(course?.title, 'Untitled course'),
    description: cleanString(course?.description),
    author: cleanString(course?.author, 'Berean Examination'),
    artworkUrl: cleanString(course?.artworkUrl),
    accent: cleanString(course?.accent, '#8B6BC2'),
    installState,
    downloadBytes: Math.max(0, finiteNumber(course?.downloadBytes)),
    downloadedBytes: Math.max(0, finiteNumber(course?.downloadedBytes)),
    downloadProgressPercent: Math.min(100, Math.max(0, finiteNumber(course?.downloadProgressPercent))),
    downloadStatus: cleanString(course?.downloadStatus),
    progressPercent,
    moduleCount: modules.length,
    lessonCount: lessons.length,
    completedLessons,
    modules,
    updatedAt: cleanString(course?.updatedAt),
    releaseNotes: cleanString(course?.releaseNotes),
    installedVersion: cleanString(course?.installedVersion),
    position,
  };
}

export function normalizeCourseLibrary(value) {
  const courses = Array.isArray(value?.courses)
    ? value.courses.map((course, index) => normalizeCourse(course, index))
    : [];

  return {
    courses,
    catalogCheckedAt: cleanString(value?.catalogCheckedAt),
    onlineModeEnabled: Boolean(value?.onlineModeEnabled),
    localCatalogConnected: Boolean(value?.localCatalogConnected),
    localCatalogFolder: cleanString(value?.localCatalogFolder),
  };
}

export function createEmptyCourseLibrary() {
  return normalizeCourseLibrary({ courses: [] });
}

export function formatCourseBytes(bytes) {
  const amount = Math.max(0, finiteNumber(bytes));
  if (!amount) return '';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const unitIndex = Math.min(Math.floor(Math.log(amount) / Math.log(1024)), units.length - 1);
  const value = amount / Math.pow(1024, unitIndex);
  return value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1) + ' ' + units[unitIndex];
}

export function formatLessonDuration(seconds) {
  const total = Math.max(0, Math.round(finiteNumber(seconds)));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (hours) return hours + 'h ' + minutes + 'm';
  return minutes + ' min';
}
