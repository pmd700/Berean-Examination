import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Captions,
  Gauge,
  Maximize2,
  Minimize2,
  Pause,
  PictureInPicture2,
  Play,
  RotateCcw,
  RotateCw,
  Volume1,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { saveCourseLessonProgress } from '@/lib/courseLibrary';
import {
  clampMediaTime,
  formatPlayerTime,
  lessonIsComplete,
  nextPlaybackRate,
  PLAYBACK_RATES,
} from '@/features/courses/playerModel';

const AUTO_SAVE_SECONDS = 10;

function PlayerButton({ active = false, children, className = '', label, onClick }) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active || undefined}
      onClick={onClick}
      className={
        'inline-flex h-10 min-w-10 items-center justify-center rounded-xl border transition-colors '
        + (active
          ? 'border-[#B99ADF]/45 bg-[#9B73CD]/20 text-white'
          : 'border-transparent text-white/80 hover:border-white/10 hover:bg-white/10 hover:text-white')
        + ' ' + className
      }
    >
      {children}
    </button>
  );
}

export default function CoursePlayer({ course, lesson, onClose, onProgressSaved, saveProgress = saveCourseLessonProgress, showClose = true }) {
  const containerRef = useRef(null);
  const videoRef = useRef(null);
  const controlsTimerRef = useRef(null);
  const lastAutoSaveRef = useRef(Math.floor(lesson.progressSeconds || 0));
  const lastSavedRef = useRef('');
  const resumedRef = useRef(false);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(lesson.progressSeconds || 0);
  const [duration, setDuration] = useState(lesson.durationSeconds || 0);
  const [bufferedEnd, setBufferedEnd] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [speedMenuOpen, setSpeedMenuOpen] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const [captionsEnabled, setCaptionsEnabled] = useState(lesson.captions.length > 0);
  const [activeCaption, setActiveCaption] = useState('');
  const [playerError, setPlayerError] = useState('');
  const [saveError, setSaveError] = useState('');

  const progressPercent = duration ? (currentTime / duration) * 100 : 0;
  const bufferedPercent = duration ? (bufferedEnd / duration) * 100 : 0;

  const persistProgress = useCallback(async ({ completed = false, notify = false } = {}) => {
    const video = videoRef.current;
    if (!video) return;
    const progressSeconds = Math.floor(clampMediaTime(video.currentTime, video.duration || duration));
    const isComplete = completed || lessonIsComplete(progressSeconds, video.duration || duration, video.ended);
    const saveKey = progressSeconds + ':' + isComplete;
    if (saveKey === lastSavedRef.current) return;
    lastSavedRef.current = saveKey;
    try {
      await saveProgress(course.id, lesson.id, { progressSeconds, completed: isComplete });
      setSaveError('');
      if (notify) await onProgressSaved?.();
    } catch (error) {
      lastSavedRef.current = '';
      setSaveError(error instanceof Error ? error.message : 'Progress could not be saved.');
    }
  }, [course.id, duration, lesson.id, onProgressSaved, saveProgress]);

  const showControls = useCallback(() => {
    setControlsVisible(true);
    window.clearTimeout(controlsTimerRef.current);
    if (playing) {
      controlsTimerRef.current = window.setTimeout(() => {
        setControlsVisible(false);
        setSpeedMenuOpen(false);
      }, 2600);
    }
  }, [playing]);

  useEffect(() => {
    showControls();
    return () => window.clearTimeout(controlsTimerRef.current);
  }, [showControls]);

  const togglePlayback = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;
    setPlayerError('');
    try {
      if (video.paused) await video.play();
      else video.pause();
    } catch {
      setPlayerError('This lesson could not start. The installed video may be unavailable.');
    }
  }, []);

  const seekBy = useCallback((seconds) => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = clampMediaTime(video.currentTime + seconds, video.duration || duration);
    setCurrentTime(video.currentTime);
    showControls();
  }, [duration, showControls]);

  const setRate = useCallback((rate) => {
    const video = videoRef.current;
    if (!video) return;
    video.playbackRate = rate;
    setPlaybackRate(rate);
    setSpeedMenuOpen(false);
    showControls();
  }, [showControls]);

  const toggleMute = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    const nextMuted = !video.muted;
    video.muted = nextMuted;
    setMuted(nextMuted);
    showControls();
  }, [showControls]);

  const toggleFullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await containerRef.current?.requestFullscreen();
    } catch {
      setPlayerError('Fullscreen is unavailable right now.');
    }
  }, []);

  const togglePictureInPicture = useCallback(async () => {
    const video = videoRef.current;
    if (!video || !document.pictureInPictureEnabled) return;
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await video.requestPictureInPicture();
    } catch {
      setPlayerError('Picture in Picture is unavailable right now.');
    }
  }, []);

  const configureCaptions = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    Array.from(video.textTracks).forEach((track, index) => {
      track.mode = captionsEnabled && index === 0 ? 'hidden' : 'disabled';
      track.oncuechange = () => {
        if (!captionsEnabled || index !== 0) return;
        const text = Array.from(track.activeCues || []).map((cue) => cue.text).join('\n');
        setActiveCaption(text);
      };
    });
    if (!captionsEnabled) setActiveCaption('');
  }, [captionsEnabled]);

  useEffect(() => {
    configureCaptions();
    return () => {
      const video = videoRef.current;
      if (!video) return;
      Array.from(video.textTracks).forEach((track) => {
        track.oncuechange = null;
      });
    };
  }, [configureCaptions]);

  useEffect(() => {
    const onFullscreenChange = () => setFullscreen(document.fullscreenElement === containerRef.current);
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, []);

  useEffect(() => {
    const onKeyDown = (event) => {
      const tagName = event.target?.tagName?.toLowerCase();
      if (['input', 'select', 'textarea', 'button'].includes(tagName)) return;
      const key = event.key.toLowerCase();
      if (key === ' ' || key === 'k') {
        event.preventDefault();
        void togglePlayback();
      } else if (key === 'arrowleft') {
        event.preventDefault();
        seekBy(-5);
      } else if (key === 'arrowright') {
        event.preventDefault();
        seekBy(5);
      } else if (key === 'j') seekBy(-10);
      else if (key === 'l') seekBy(10);
      else if (key === 'm') toggleMute();
      else if (key === 'c' && lesson.captions.length) setCaptionsEnabled((value) => !value);
      else if (key === 'f') void toggleFullscreen();
      else if (key === '>') setRate(nextPlaybackRate(playbackRate));
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [lesson.captions.length, playbackRate, seekBy, setRate, toggleFullscreen, toggleMute, togglePlayback]);

  const updateBuffer = useCallback(() => {
    const video = videoRef.current;
    if (!video || !video.buffered.length) return setBufferedEnd(0);
    setBufferedEnd(video.buffered.end(video.buffered.length - 1));
  }, []);

  const onLoadedMetadata = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    const mediaDuration = Number.isFinite(video.duration) ? video.duration : lesson.durationSeconds;
    setDuration(mediaDuration || 0);
    if (!resumedRef.current && lesson.progressSeconds > 0 && lesson.progressSeconds < mediaDuration - 2) {
      video.currentTime = lesson.progressSeconds;
      setCurrentTime(lesson.progressSeconds);
    }
    resumedRef.current = true;
    configureCaptions();
  }, [configureCaptions, lesson.durationSeconds, lesson.progressSeconds]);

  const onTimeUpdate = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    setCurrentTime(video.currentTime);
    updateBuffer();
    if (video.currentTime - lastAutoSaveRef.current >= AUTO_SAVE_SECONDS) {
      lastAutoSaveRef.current = Math.floor(video.currentTime);
      void persistProgress();
    }
  }, [persistProgress, updateBuffer]);

  const closePlayer = useCallback(async () => {
    await persistProgress({ notify: true });
    onClose();
  }, [onClose, persistProgress]);

  const volumeIcon = useMemo(() => {
    if (muted || volume === 0) return VolumeX;
    if (volume < 0.55) return Volume1;
    return Volume2;
  }, [muted, volume]);
  const VolumeIcon = volumeIcon;

  return (
    <section
      ref={containerRef}
      tabIndex={0}
      onMouseMove={showControls}
      onMouseLeave={() => playing && setControlsVisible(false)}
      className="group relative aspect-video overflow-hidden rounded-3xl border border-white/[0.1] bg-black shadow-[0_30px_100px_rgba(0,0,0,.48)] outline-none focus-visible:ring-2 focus-visible:ring-[#9C78CC]"
      data-testid="course-player"
    >
      <video
        ref={videoRef}
        src={lesson.mediaUrl}
        poster={lesson.posterUrl || undefined}
        preload="metadata"
        controls={false}
        crossOrigin="anonymous"
        playsInline
        onClick={togglePlayback}
        onCanPlay={configureCaptions}
        onDurationChange={onLoadedMetadata}
        onLoadedMetadata={onLoadedMetadata}
        onPlay={() => {
          setPlaying(true);
          showControls();
        }}
        onPause={() => {
          setPlaying(false);
          setControlsVisible(true);
          void persistProgress();
        }}
        onEnded={() => {
          setPlaying(false);
          setControlsVisible(true);
          void persistProgress({ completed: true, notify: true });
        }}
        onError={() => setPlayerError('This installed video could not be opened.')}
        onProgress={updateBuffer}
        onTimeUpdate={onTimeUpdate}
        className="h-full w-full cursor-pointer bg-black object-contain"
      >
        {lesson.captions.map((caption, index) => (
          <track
            key={caption.id}
            kind="captions"
            src={caption.url}
            srcLang={caption.language}
            label={caption.label}
            default={index === 0}
          />
        ))}
      </video>

      <div className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-black/65 to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-52 bg-gradient-to-t from-black/95 via-black/55 to-transparent" />

      <div className={'absolute inset-x-0 top-0 flex items-center justify-between p-4 transition-opacity ' + (controlsVisible ? 'opacity-100' : 'pointer-events-none opacity-0')}>
        <div className="min-w-0 pr-4">
          <p className="truncate text-xs font-semibold uppercase tracking-[0.18em] text-white/55">{course.title}</p>
          <h2 className="mt-1 truncate text-base font-semibold text-white">{lesson.title}</h2>
        </div>
        {showClose && (
          <PlayerButton label="Close player" onClick={() => void closePlayer()}>
            <X className="h-5 w-5" />
          </PlayerButton>
        )}
      </div>

      {!playing && !playerError && (
        <button
          type="button"
          aria-label="Play lesson"
          onClick={togglePlayback}
          className="absolute left-1/2 top-1/2 flex h-20 w-20 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-white/20 bg-black/45 text-white shadow-2xl backdrop-blur-md transition-transform hover:scale-105"
        >
          <Play className="ml-1 h-8 w-8 fill-white" />
        </button>
      )}

      {captionsEnabled && activeCaption && (
        <div className="pointer-events-none absolute inset-x-8 bottom-24 flex justify-center">
          <p className="max-w-[88%] whitespace-pre-line rounded-lg bg-black/82 px-4 py-2 text-center text-base font-medium leading-6 text-white shadow-lg md:text-lg">
            {activeCaption}
          </p>
        </div>
      )}

      {(playerError || saveError) && (
        <div className="absolute left-1/2 top-1/2 max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-red-300/20 bg-[#170E12]/95 px-5 py-4 text-center text-sm text-red-100 shadow-2xl">
          {playerError || saveError}
        </div>
      )}

      <div className={'absolute inset-x-0 bottom-0 p-4 transition-opacity md:p-5 ' + (controlsVisible ? 'opacity-100' : 'pointer-events-none opacity-0')}>
        <div className="relative mb-3 h-5 cursor-pointer">
          <div className="absolute inset-x-0 top-2 h-1 rounded-full bg-white/20">
            <div className="absolute inset-y-0 left-0 rounded-full bg-white/20" style={{ width: Math.min(100, bufferedPercent) + '%' }} />
            <div className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-[#9E76D3] to-[#D8BC68]" style={{ width: Math.min(100, progressPercent) + '%' }} />
          </div>
          <input
            type="range"
            min="0"
            max={Math.max(duration, 0.01)}
            step="0.1"
            value={Math.min(currentTime, Math.max(duration, 0.01))}
            aria-label="Lesson position"
            onChange={(event) => {
              const value = Number(event.target.value);
              if (videoRef.current) videoRef.current.currentTime = value;
              setCurrentTime(value);
            }}
            onPointerUp={() => void persistProgress()}
            onKeyUp={() => void persistProgress()}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          />
        </div>

        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-1">
            <PlayerButton label={playing ? 'Pause' : 'Play'} onClick={togglePlayback}>
              {playing ? <Pause className="h-5 w-5 fill-current" /> : <Play className="ml-0.5 h-5 w-5 fill-current" />}
            </PlayerButton>
            <PlayerButton label="Back 10 seconds" onClick={() => seekBy(-10)}>
              <RotateCcw className="h-5 w-5" />
              <span className="sr-only">10 seconds</span>
            </PlayerButton>
            <PlayerButton label="Forward 10 seconds" onClick={() => seekBy(10)}>
              <RotateCw className="h-5 w-5" />
              <span className="sr-only">10 seconds</span>
            </PlayerButton>
            <div className="group/volume hidden items-center sm:flex">
              <PlayerButton label={muted ? 'Unmute' : 'Mute'} onClick={toggleMute}>
                <VolumeIcon className="h-5 w-5" />
              </PlayerButton>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={muted ? 0 : volume}
                aria-label="Volume"
                onChange={(event) => {
                  const value = Number(event.target.value);
                  setVolume(value);
                  setMuted(value === 0);
                  if (videoRef.current) {
                    videoRef.current.volume = value;
                    videoRef.current.muted = value === 0;
                  }
                }}
                className="w-0 accent-[#B38BDA] opacity-0 transition-all group-hover/volume:w-20 group-hover/volume:opacity-100 group-focus-within/volume:w-20 group-focus-within/volume:opacity-100"
              />
            </div>
            <span className="ml-1 whitespace-nowrap text-xs font-medium tabular-nums text-white/70">
              {formatPlayerTime(currentTime)} <span className="text-white/35">/</span> {formatPlayerTime(duration)}
            </span>
          </div>

          <div className="flex items-center gap-1">
            {lesson.captions.length > 0 && (
              <PlayerButton
                active={captionsEnabled}
                label={captionsEnabled ? 'Turn captions off' : 'Turn captions on'}
                onClick={() => setCaptionsEnabled((value) => !value)}
              >
                <Captions className="h-5 w-5" />
              </PlayerButton>
            )}
            <div className="relative">
              <PlayerButton
                active={speedMenuOpen}
                label="Playback speed"
                onClick={() => setSpeedMenuOpen((value) => !value)}
                className="gap-1.5 px-2"
              >
                <Gauge className="h-4 w-4" />
                <span className="text-xs font-bold tabular-nums">{playbackRate}×</span>
              </PlayerButton>
              {speedMenuOpen && (
                <div className="absolute bottom-12 right-0 w-32 overflow-hidden rounded-xl border border-white/10 bg-[#12141A]/98 p-1 shadow-2xl backdrop-blur-xl">
                  {PLAYBACK_RATES.map((rate) => (
                    <button
                      key={rate}
                      type="button"
                      onClick={() => setRate(rate)}
                      className={'flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-white/[0.08] ' + (rate === playbackRate ? 'text-[#D8C3F1]' : 'text-white/70')}
                    >
                      {rate === 1 ? 'Normal' : rate + '×'}
                      {rate === playbackRate && <span className="h-1.5 w-1.5 rounded-full bg-[#B38BDA]" />}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {typeof document !== 'undefined' && document.pictureInPictureEnabled && (
              <PlayerButton label="Picture in Picture" onClick={togglePictureInPicture}>
                <PictureInPicture2 className="h-5 w-5" />
              </PlayerButton>
            )}
            <PlayerButton label={fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'} onClick={toggleFullscreen}>
              {fullscreen ? <Minimize2 className="h-5 w-5" /> : <Maximize2 className="h-5 w-5" />}
            </PlayerButton>
          </div>
        </div>
      </div>
    </section>
  );
}
