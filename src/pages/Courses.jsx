import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import CoursePlayer from '@/components/courses/CoursePlayer';
import BackToLibraryHomeButton from '@/components/navigation/BackToLibraryHomeButton';
import {
  ArrowLeft,
  BookOpenCheck,
  Check,
  ChevronRight,
  Circle,
  Clock3,
  Download,
  FolderOpen,
  GraduationCap,
  HardDrive,
  LibraryBig,
  Play,
  PackagePlus,
  RefreshCw,
  Search,
  Sparkles,
  WifiOff,
} from 'lucide-react';
import { chooseAndInstallCoursePackage, connectLocalCourseCatalog, installCourseFromCatalog, onCourseDownloadProgress, pauseCourseDownload, readCourseLibrary } from '@/lib/courseLibrary';
import {
  COURSE_INSTALL_STATES,
  formatCourseBytes,
  formatLessonDuration,
} from '@/features/courses/courseLibraryModel';

const FILTERS = Object.freeze([
  { id: 'library', label: 'My Library' },
  { id: 'available', label: 'Available' },
  { id: 'updates', label: 'Updates' },
]);

function CourseArtwork({ course, compact = false }) {
  if (course.artworkUrl) {
    return (
      <img
        src={course.artworkUrl}
        alt=""
        className="h-full w-full object-cover"
        draggable="false"
      />
    );
  }

  return (
    <div
      className="relative flex h-full w-full items-center justify-center overflow-hidden"
      style={{
        background:
          'radial-gradient(circle at 24% 18%, ' + course.accent + '55, transparent 44%), linear-gradient(145deg, #171422, #090A0E 72%)',
      }}
      aria-hidden="true"
    >
      <div className="absolute inset-0 opacity-30 [background-image:linear-gradient(rgba(255,255,255,.05)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.05)_1px,transparent_1px)] [background-size:32px_32px]" />
      <GraduationCap className={compact ? 'h-10 w-10 text-white/75' : 'h-16 w-16 text-white/75'} strokeWidth={1.25} />
    </div>
  );
}

function ProgressLine({ value }) {
  return (
    <div className="h-1 overflow-hidden rounded-full bg-white/[0.07]">
      <motion.div
        className="h-full rounded-full bg-gradient-to-r from-[#7351AA] to-gold"
        initial={{ width: 0 }}
        animate={{ width: Math.max(0, Math.min(100, value)) + '%' }}
        transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
      />
    </div>
  );
}

function InstallBadge({ course }) {
  if (course.installState === COURSE_INSTALL_STATES.INSTALLED) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/20 bg-emerald-400/[0.07] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-emerald-200">
        <Check className="h-3 w-3" />
        Installed
      </span>
    );
  }
  if (course.installState === COURSE_INSTALL_STATES.UPDATE_AVAILABLE) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-gold/25 bg-gold/[0.08] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#E4CA78]">
        <RefreshCw className="h-3 w-3" />
        Update
      </span>
    );
  }
  if (course.installState === COURSE_INSTALL_STATES.DOWNLOADING) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-[#8B6BC2]/30 bg-[#8B6BC2]/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#C5AFE8]">
        <Download className="h-3 w-3" />
        {course.downloadStatus === 'downloading' ? 'Downloading' : 'Paused'}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-muted">
      <Download className="h-3 w-3" />
      Available
    </span>
  );
}

function CourseCard({ course, onOpen }) {
  return (
    <motion.button
      type="button"
      onClick={() => onOpen(course.id)}
      className="group overflow-hidden rounded-2xl border border-white/[0.08] bg-[#11141B] text-left shadow-[0_18px_70px_rgba(0,0,0,.18)] transition-colors hover:border-white/[0.16]"
      whileHover={{ y: -3 }}
      whileTap={{ scale: 0.995 }}
      data-testid={'course-card-' + course.id}
    >
      <div className="aspect-[16/9] overflow-hidden border-b border-white/[0.07]">
        <CourseArtwork course={course} />
      </div>
      <div className="p-5">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#7F8A9D]">
              {course.author}
            </p>
            <h3 className="line-clamp-2 text-xl font-semibold leading-tight text-[#F2F3F6]">
              {course.title}
            </h3>
          </div>
          <ChevronRight className="mt-1 h-5 w-5 shrink-0 text-[#596174] transition-transform group-hover:translate-x-0.5 group-hover:text-white" />
        </div>
        <div className="mb-4 flex flex-wrap items-center gap-3 text-xs text-[#7F8A9D]">
          <span>{course.moduleCount} modules</span>
          <span className="h-1 w-1 rounded-full bg-[#3A4050]" />
          <span>{course.lessonCount} lessons</span>
          {course.downloadBytes > 0 && (
            <>
              <span className="h-1 w-1 rounded-full bg-[#3A4050]" />
              <span>{formatCourseBytes(course.downloadBytes)}</span>
            </>
          )}
        </div>
        {course.installState === COURSE_INSTALL_STATES.DOWNLOADING ? (
          <div className="space-y-2"><ProgressLine value={course.downloadProgressPercent} /><div className="flex justify-between text-[11px] text-[#7F8A9D]"><span>{course.downloadStatus === 'downloading' ? 'Downloading' : 'Ready to resume'}</span><span>{Math.round(course.downloadProgressPercent)}%</span></div></div>
        ) : course.installState === COURSE_INSTALL_STATES.INSTALLED && course.progressPercent > 0 ? (
          <div className="space-y-2">
            <ProgressLine value={course.progressPercent} />
            <div className="flex justify-between text-[11px] text-[#7F8A9D]">
              <span>{course.completedLessons} of {course.lessonCount} complete</span>
              <span>{Math.round(course.progressPercent)}%</span>
            </div>
          </div>
        ) : (
          <InstallBadge course={course} />
        )}
      </div>
    </motion.button>
  );
}

function EmptyShelf({ filter, query, onlineModeEnabled }) {
  const searching = Boolean(query);
  const content = searching
    ? {
        title: 'No matching courses',
        body: 'Try another course name or description.',
        icon: Search,
      }
    : filter === 'updates'
      ? {
          title: 'Everything is current',
          body: 'Course updates will appear here before anything is downloaded.',
          icon: RefreshCw,
        }
      : filter === 'available'
        ? {
            title: onlineModeEnabled ? 'No courses available' : 'Online Mode is off',
            body: onlineModeEnabled
              ? 'Newly published courses will appear here.'
              : 'Your installed courses still work. Enable Online Mode later to see new releases.',
            icon: onlineModeEnabled ? LibraryBig : WifiOff,
          }
        : {
            title: 'Your course shelf is ready',
            body: 'Installed courses will live here and remain available without Internet.',
            icon: BookOpenCheck,
          };
  const Icon = content.icon;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex min-h-[340px] flex-col items-center justify-center rounded-3xl border border-dashed border-white/[0.1] bg-white/[0.018] px-6 text-center"
      data-testid="courses-empty-state"
    >
      <div className="flex flex-col items-center [@media(max-height:760px)]:-translate-y-24">
        <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl border border-white/[0.09] bg-[#151821] shadow-[0_12px_40px_rgba(0,0,0,.25)]">
          <Icon className="h-6 w-6 text-[#AD96D4]" strokeWidth={1.5} />
        </div>
        <h2 className="text-2xl font-semibold text-[#F2F3F6]">{content.title}</h2>
        <p className="mt-2 max-w-md text-sm leading-6 text-[#818B9D]">{content.body}</p>
      </div>
    </motion.div>
  );
}

function LessonRow({ lesson, number, onOpen }) {
  const isInProgress = lesson.progressSeconds > 0 && !lesson.completed;
  const available = Boolean(lesson.mediaUrl);
  return (
    <button
      type="button"
      disabled={!available}
      onClick={() => available && onOpen(lesson)}
      className="group flex w-full items-center gap-4 border-t border-white/[0.06] px-5 py-4 text-left first:border-t-0 enabled:hover:bg-white/[0.025] disabled:cursor-default"
      data-testid={'course-lesson-' + lesson.id}
    >
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/[0.09] bg-white/[0.025]">
        {lesson.completed ? (
          <Check className="h-4 w-4 text-emerald-300" />
        ) : isInProgress ? (
          <Play className="ml-0.5 h-3.5 w-3.5 fill-[#BDA4E5] text-[#BDA4E5]" />
        ) : (
          <span className="text-xs font-semibold text-[#687286]">{number}</span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-4">
          <h4 className="truncate text-[15px] font-semibold text-[#DDE1E8]">{lesson.title}</h4>
          <span className="flex shrink-0 items-center gap-1.5 text-xs text-[#687286]">
            <Clock3 className="h-3.5 w-3.5" />
            {formatLessonDuration(lesson.durationSeconds)}
          </span>
        </div>
        {isInProgress && (
          <div className="mt-2 max-w-sm">
            <ProgressLine value={(lesson.progressSeconds / Math.max(1, lesson.durationSeconds)) * 100} />
          </div>
        )}
      </div>
      {available && (
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/[0.08] text-[#7F899B] transition-all group-hover:border-[#9B73CD]/40 group-hover:bg-[#9B73CD]/10 group-hover:text-[#D8C3F1]">
          <Play className="ml-0.5 h-3.5 w-3.5 fill-current" />
        </span>
      )}
    </button>
  );
}

function CourseDetail({ course, downloadProgress, installing, onBack, onInstall, onPause, onProgressSaved }) {
  const [activeLesson, setActiveLesson] = useState(null);
  return (
    <motion.div
      initial={{ opacity: 0, x: 12 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 12 }}
      className="mx-auto max-w-6xl px-6 pb-20 pt-8 md:px-10"
      data-testid="course-detail"
    >
      <button
        type="button"
        onClick={onBack}
        className="mb-8 inline-flex items-center gap-2 text-sm font-semibold text-[#8893A6] transition-colors hover:text-white"
      >
        <ArrowLeft className="h-4 w-4" />
        All courses
      </button>

      <AnimatePresence mode="wait">
        {activeLesson ? (
          <motion.div
            key={'player-' + activeLesson.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
          >
            <CoursePlayer
              course={course}
              lesson={activeLesson}
              onClose={() => setActiveLesson(null)}
              onProgressSaved={onProgressSaved}
            />
          </motion.div>
        ) : (
          <motion.div
            key="course-overview"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="grid gap-8 lg:grid-cols-[minmax(0,1.08fr)_minmax(320px,.92fr)]"
          >
            <div className="overflow-hidden rounded-3xl border border-white/[0.09] bg-[#10131A]">
              <div className="aspect-video">
                <CourseArtwork course={course} />
              </div>
            </div>
            <div className="flex flex-col justify-center">
              <div className="mb-5"><InstallBadge course={course} /></div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#9C83C8]">{course.author}</p>
              <h1 className="mt-3 text-4xl font-semibold leading-[1.04] text-white md:text-5xl">{course.title}</h1>
              {course.description && (
                <p className="mt-5 max-w-xl text-base leading-7 text-[#919BAD]">{course.description}</p>
              )}
              <div className="mt-7 flex flex-wrap gap-x-6 gap-y-2 text-sm text-[#7E889A]">
                <span>{course.moduleCount} modules</span>
                <span>{course.lessonCount} lessons</span>
                {course.downloadBytes > 0 && <span>{formatCourseBytes(course.downloadBytes)}</span>}
              </div>
              {[COURSE_INSTALL_STATES.AVAILABLE, COURSE_INSTALL_STATES.UPDATE_AVAILABLE, COURSE_INSTALL_STATES.DOWNLOADING].includes(course.installState) && <div className="mt-7 max-w-md"><button type="button" onClick={() => installing ? onPause(course.id) : onInstall(course.id)} className={'inline-flex h-11 w-fit items-center justify-center gap-2 rounded-xl px-5 text-sm font-semibold transition-colors ' + (installing ? 'border border-amber-300/20 bg-amber-300/[0.07] text-amber-100 hover:bg-amber-300/[0.11]' : 'bg-[#8E67C5] text-white hover:bg-[#9B73D0]')}>
                {installing ? <Circle className="h-4 w-4 fill-current" /> : <Download className="h-4 w-4" />}
                {installing ? 'Pause download' : course.installState === COURSE_INSTALL_STATES.DOWNLOADING ? 'Resume download' : course.installState === COURSE_INSTALL_STATES.UPDATE_AVAILABLE ? 'Install update ' + course.version : 'Install course'}
              </button>{course.installState === COURSE_INSTALL_STATES.DOWNLOADING && <div className="mt-4 space-y-2"><ProgressLine value={downloadProgress?.progressPercent ?? course.downloadProgressPercent} /><div className="flex justify-between text-xs text-[#7E889A]"><span>{installing ? 'Safe to pause at any time' : 'Saved and ready to resume'}</span><span>{Math.round(downloadProgress?.progressPercent ?? course.downloadProgressPercent)}%</span></div></div>}</div>}
              {course.installState === COURSE_INSTALL_STATES.INSTALLED && (
                <div className="mt-7 max-w-md space-y-2">
                  <div className="flex justify-between text-xs font-semibold text-[#8D97A8]">
                    <span>Your progress</span>
                    <span>{Math.round(course.progressPercent)}%</span>
                  </div>
                  <ProgressLine value={course.progressPercent} />
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="mt-14">
        <div className="mb-5 flex items-end justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#786092]">Course outline</p>
            <h2 className="mt-2 text-2xl font-semibold text-white">Lessons</h2>
          </div>
          <span className="text-xs text-[#687286]">Version {course.version}</span>
        </div>
        <div className="space-y-4">
          {course.modules.map((module, moduleIndex) => (
            <section
              key={module.id}
              className="overflow-hidden rounded-2xl border border-white/[0.08] bg-[#11141B]"
            >
              <div className="flex items-center gap-4 px-5 py-5">
                <span className="text-xs font-semibold text-[#8066AD]">
                  {String(moduleIndex + 1).padStart(2, '0')}
                </span>
                <div>
                  <h3 className="text-lg font-semibold text-[#EEF0F4]">{module.title}</h3>
                  {module.description && <p className="mt-1 text-sm text-[#7F899B]">{module.description}</p>}
                </div>
              </div>
              <div className="border-t border-white/[0.07]">
                {module.lessons.map((lesson, lessonIndex) => (
                  <LessonRow
                    key={lesson.id}
                    lesson={lesson}
                    number={lessonIndex + 1}
                    onOpen={setActiveLesson}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </motion.div>
  );
}

export default function Courses() {
  const [library, setLibrary] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [filter, setFilter] = useState('library');
  const [query, setQuery] = useState('');
  const [selectedCourseId, setSelectedCourseId] = useState(null);
  const [installingPackage, setInstallingPackage] = useState(false);
  const [connectingCatalog, setConnectingCatalog] = useState(false);
  const [installingCourseId, setInstallingCourseId] = useState('');
  const [downloadProgress, setDownloadProgress] = useState({});
  const [installError, setInstallError] = useState('');

  const loadLibrary = useCallback(async () => {
    setLoadError('');
    try {
      setLibrary(await readCourseLibrary());
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'BEX could not open the course library.');
    }
  }, []);

  useEffect(() => {
    void loadLibrary();
  }, [loadLibrary]);

  useEffect(() => onCourseDownloadProgress((progress) => {
    if (!progress?.courseId) return;
    setDownloadProgress((current) => ({ ...current, [progress.courseId]: progress }));
    setLibrary((current) => current ? { ...current, courses: current.courses.map((course) => course.id === progress.courseId ? { ...course, installState: progress.status === 'completed' ? course.installState : COURSE_INSTALL_STATES.DOWNLOADING, downloadStatus: progress.status, downloadedBytes: progress.downloadedBytes, downloadBytes: progress.totalBytes, downloadProgressPercent: progress.progressPercent } : course) } : current);
  }), []);

  const connectCatalog = useCallback(async () => {
    setInstallError(''); setConnectingCatalog(true);
    try {
      const result = await connectLocalCourseCatalog();
      if (result.canceled) return;
      await loadLibrary();
      setFilter('available'); setQuery('');
    } catch (error) {
      setInstallError(error instanceof Error ? error.message : 'BEX could not connect that Course catalog.');
    } finally { setConnectingCatalog(false); }
  }, [loadLibrary]);

  const installCatalogCourse = useCallback(async (courseId) => {
    setInstallError(''); setInstallingCourseId(courseId);
    try {
      await installCourseFromCatalog(courseId);
      await loadLibrary();
      setFilter('library'); setSelectedCourseId(courseId);
    } catch (error) {
      setInstallError(error instanceof Error ? error.message : 'BEX could not install that Course.');
    } finally { setInstallingCourseId(''); }
  }, [loadLibrary]);

  const pauseCatalogCourse = useCallback(async (courseId) => {
    try { await pauseCourseDownload(courseId); }
    catch (error) { setInstallError(error instanceof Error ? error.message : 'BEX could not pause that Course download.'); }
  }, []);

  const installPackage = useCallback(async () => {
    setInstallError('');
    setInstallingPackage(true);
    try {
      const result = await chooseAndInstallCoursePackage();
      if (result.canceled) return;
      await loadLibrary();
      setFilter('library');
      setQuery('');
      setSelectedCourseId(result.course?.id || null);
    } catch (error) {
      setInstallError(error instanceof Error ? error.message : 'BEX could not install that Course package.');
    } finally {
      setInstallingPackage(false);
    }
  }, [loadLibrary]);

  const courses = library?.courses || [];
  const selectedCourse = courses.find((course) => course.id === selectedCourseId) || null;
  const counts = useMemo(() => ({
    library: courses.filter((course) => (
      course.installState === COURSE_INSTALL_STATES.INSTALLED
      || course.installState === COURSE_INSTALL_STATES.DOWNLOADING
      || course.installState === COURSE_INSTALL_STATES.UPDATE_AVAILABLE
    )).length,
    available: courses.filter((course) => course.installState === COURSE_INSTALL_STATES.AVAILABLE).length,
    updates: courses.filter((course) => course.installState === COURSE_INSTALL_STATES.UPDATE_AVAILABLE).length,
  }), [courses]);

  const visibleCourses = useMemo(() => {
    const search = query.trim().toLowerCase();
    return courses.filter((course) => {
      const matchesFilter = filter === 'library'
        ? course.installState !== COURSE_INSTALL_STATES.AVAILABLE
        : filter === 'available'
          ? course.installState === COURSE_INSTALL_STATES.AVAILABLE
          : course.installState === COURSE_INSTALL_STATES.UPDATE_AVAILABLE;
      if (!matchesFilter) return false;
      return !search
        || course.title.toLowerCase().includes(search)
        || course.description.toLowerCase().includes(search)
        || course.author.toLowerCase().includes(search);
    });
  }, [courses, filter, query]);

  return (
    <main className="relative min-h-screen overflow-hidden bg-app text-ink">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-32 -top-48 h-[560px] w-[560px] rounded-full bg-[#5E3D91]/[0.13] blur-[120px]" />
        <div className="absolute right-[-180px] top-[28%] h-[520px] w-[520px] rounded-full bg-gold/[0.035] blur-[130px]" />
        <div className="absolute inset-0 opacity-[0.13] [background-image:linear-gradient(rgba(255,255,255,.035)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.035)_1px,transparent_1px)] [background-size:72px_72px]" />
      </div>

      <AnimatePresence mode="wait">
        {selectedCourse ? (
          <CourseDetail
            key={'detail-' + selectedCourse.id}
            course={selectedCourse}
            downloadProgress={downloadProgress[selectedCourse.id]}
            installing={installingCourseId === selectedCourse.id}
            onBack={() => setSelectedCourseId(null)}
            onInstall={installCatalogCourse}
            onPause={pauseCatalogCourse}
            onProgressSaved={loadLibrary}
          />
        ) : (
          <motion.div
            key="course-library"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="relative mx-auto max-w-7xl px-6 pb-20 pt-12 md:px-10 lg:pt-16"
          >
            <BackToLibraryHomeButton className="mb-7" />
            <header className="mb-12 flex flex-col justify-between gap-8 lg:flex-row lg:items-end">
              <div className="max-w-3xl">
                <div className="mb-5 flex items-center gap-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.035]">
                    <GraduationCap className="h-4.5 w-4.5 text-[#B79DDE]" />
                  </span>
                  <span className="text-xs font-semibold uppercase tracking-[0.24em] text-[#A890D0]">Berean Courses</span>
                </div>
                <h1 className="text-5xl font-semibold leading-[.96] tracking-[-0.025em] text-white md:text-7xl">
                  Study deeply.
                  <span className="block bg-gradient-to-r from-[#BCA4E4] via-[#D7C9EC] to-[#E8DDAF] bg-clip-text text-transparent">
                    Keep every lesson.
                  </span>
                </h1>
                <p className="mt-6 max-w-2xl text-base leading-7 text-[#8791A3] md:text-lg">
                  Download once, learn without Internet, and keep your progress inside your Berean Library.
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-3 rounded-2xl border border-white/[0.08] bg-[#11141B]/85 px-4 py-3 shadow-[0_16px_60px_rgba(0,0,0,.24)] backdrop-blur">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-400/[0.08]">
                  <HardDrive className="h-4 w-4 text-emerald-300" />
                </span>
                <div>
                  <p className="text-sm font-semibold text-[#E3E6EB]">Offline library</p>
                  <p className="text-xs text-[#737D90]">Stored in your Berean Library</p>
                </div>
              </div>
            </header>

            <section>
              <div className="mb-7 flex flex-col justify-between gap-4 border-b border-white/[0.07] pb-5 md:flex-row md:items-center">
                <div className="flex items-center gap-1 rounded-xl border border-white/[0.07] bg-[#11141B] p-1">
                  {FILTERS.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setFilter(item.id)}
                      className={
                        'rounded-lg px-4 py-2 text-sm font-semibold transition-all '
                        + (filter === item.id
                          ? 'bg-[#272031] text-white shadow-sm'
                          : 'text-[#778195] hover:text-[#D5D9E0]')
                      }
                    >
                      {item.label}
                      {counts[item.id] > 0 && (
                        <span className="ml-2 text-[10px] text-[#A992D0]">{counts[item.id]}</span>
                      )}
                    </button>
                  ))}
                </div>

                <div className="flex w-full flex-col gap-3 sm:flex-row md:w-auto">
                  <button
                    type="button"
                    onClick={connectCatalog}
                    disabled={connectingCatalog}
                    className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-emerald-400/20 bg-emerald-400/[0.06] px-4 text-sm font-semibold text-emerald-100 transition-colors hover:bg-emerald-400/[0.1] disabled:cursor-wait disabled:opacity-60"
                    data-testid="button-connect-course-catalog"
                  >
                    {connectingCatalog ? <RefreshCw className="h-4 w-4 animate-spin" /> : <FolderOpen className="h-4 w-4" />}
                    {connectingCatalog ? 'Connecting…' : library?.localCatalogConnected ? 'Change test catalog' : 'Connect test catalog'}
                  </button>
                  <button
                    type="button"
                    onClick={installPackage}
                    disabled={installingPackage}
                    className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-[#8B6BC2]/35 bg-[#8B6BC2]/10 px-4 text-sm font-semibold text-[#D5C4ED] transition-colors hover:bg-[#8B6BC2]/16 disabled:cursor-wait disabled:opacity-60"
                    data-testid="button-install-course-package"
                  >
                    <PackagePlus className="h-4 w-4" />
                    {installingPackage ? 'Checking package…' : 'Install package'}
                  </button>
                  <label className="flex h-11 w-full items-center gap-3 rounded-xl border border-white/[0.08] bg-[#11141B] px-4 transition-colors focus-within:border-[#7656A8]/70 md:w-72">
                    <Search className="h-4 w-4 shrink-0 text-[#697386]" />
                    <input
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="Search courses"
                      className="w-full bg-transparent text-sm text-[#E6E8ED] outline-none placeholder:text-[#596274]"
                      data-testid="input-course-search"
                    />
                  </label>
                </div>
              </div>

              {installError && (
                <div className="mb-5 rounded-xl border border-red-400/15 bg-red-400/[0.04] px-4 py-3 text-sm text-red-200">
                  {installError}
                </div>
              )}

              {!library && !loadError ? (
                <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
                  {[0, 1, 2].map((item) => (
                    <div key={item} className="aspect-[4/3] animate-pulse rounded-2xl border border-white/[0.06] bg-white/[0.025]" />
                  ))}
                </div>
              ) : loadError ? (
                <div className="flex min-h-[340px] flex-col items-center justify-center rounded-3xl border border-red-400/15 bg-red-400/[0.025] px-6 text-center">
                  <Circle className="mb-5 h-8 w-8 text-red-300" />
                  <h2 className="text-xl font-semibold text-white">Course library unavailable</h2>
                  <p className="mt-2 max-w-md text-sm text-[#929BAC]">{loadError}</p>
                  <button
                    type="button"
                    onClick={loadLibrary}
                    className="mt-6 inline-flex items-center gap-2 rounded-xl border border-white/[0.1] bg-white/[0.04] px-4 py-2 text-sm font-semibold text-white hover:bg-white/[0.07]"
                  >
                    <RefreshCw className="h-4 w-4" />
                    Try again
                  </button>
                </div>
              ) : visibleCourses.length ? (
                <motion.div
                  layout
                  className="grid gap-5 md:grid-cols-2 xl:grid-cols-3"
                  data-testid="course-grid"
                >
                  {visibleCourses.map((course) => (
                    <CourseCard key={course.id} course={course} onOpen={setSelectedCourseId} />
                  ))}
                </motion.div>
              ) : (
                <EmptyShelf
                  filter={filter}
                  query={query}
                  onlineModeEnabled={Boolean(library?.onlineModeEnabled)}
                />
              )}
            </section>

            <footer className="mt-7 flex items-center justify-center gap-2 text-xs text-[#525B6C]">
              <Sparkles className="h-3.5 w-3.5" />
              Course updates are verified before they reach your library.
            </footer>
          </motion.div>
        )}
      </AnimatePresence>
    </main>
  );
}
