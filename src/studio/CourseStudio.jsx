import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertTriangle, ArrowDown, ArrowLeft, ArrowUp, Captions, Check, CheckCircle2, ChevronRight, Clapperboard,
  FileVideo, FolderOpen, Image, Layers3, LoaderCircle, PackageCheck, Plus, Save, Trash2, X,
} from 'lucide-react';
import CoursePlayer from '@/components/courses/CoursePlayer';
import { chooseAsset, createProject, exportPackage, listRecentProjects, openProject, openRecentProject, publishBeta, publishingStatus, saveProject, saveProjectNow, setChannelVersion, validateProject } from './studioClient';

const clone = (value) => structuredClone(value);
const newId = (prefix) => prefix + '-' + crypto.randomUUID();

function Field({ label, multiline = false, value, onChange, placeholder = '' }) {
  const Component = multiline ? 'textarea' : 'input';
  return (
    <label className="block">
      <span className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.16em] text-[#7F899D]">{label}</span>
      <Component
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        rows={multiline ? 5 : undefined}
        className="w-full resize-none rounded-xl border border-white/[0.08] bg-[#0D1016] px-4 py-3 text-sm text-white outline-none transition focus:border-[#8F6BC0]/70 placeholder:text-[#4E5768]"
      />
    </label>
  );
}

function MoveButtons({ index, length, onMove, onRemove }) {
  return (
    <div className="flex items-center gap-1 opacity-55 transition group-hover:opacity-100">
      <button type="button" disabled={index === 0} onClick={(event) => { event.stopPropagation(); onMove(-1); }} className="rounded-lg p-1.5 hover:bg-white/[0.07] disabled:opacity-20" aria-label="Move up"><ArrowUp className="h-3.5 w-3.5" /></button>
      <button type="button" disabled={index === length - 1} onClick={(event) => { event.stopPropagation(); onMove(1); }} className="rounded-lg p-1.5 hover:bg-white/[0.07] disabled:opacity-20" aria-label="Move down"><ArrowDown className="h-3.5 w-3.5" /></button>
      <button type="button" onClick={(event) => { event.stopPropagation(); onRemove(); }} className="rounded-lg p-1.5 text-red-200 hover:bg-red-400/10" aria-label="Remove"><Trash2 className="h-3.5 w-3.5" /></button>
    </div>
  );
}

function Welcome({ error, loading, onCreate, onOpen, onRecent, recent }) {
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#090B10] px-6 text-white">
      <div className="absolute -left-40 -top-48 h-[620px] w-[620px] rounded-full bg-[#624095]/20 blur-[150px]" />
      <div className="relative w-full max-w-4xl">
        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[#B59BDC]">BEX Course Studio</p>
        <h1 className="mt-5 max-w-3xl text-6xl font-semibold leading-[.94] tracking-[-.03em]">Build the course.<span className="block text-[#BFA9E0]">Keep the video yours.</span></h1>
        <p className="mt-6 max-w-2xl text-lg leading-7 text-[#8892A4]">Organize finished videos, thumbnails, captions, modules, and descriptions. Studio never edits or moves your source media.</p>
        <div className="mt-10 flex flex-wrap gap-3">
          <button type="button" disabled={loading} onClick={onCreate} className="inline-flex h-12 items-center gap-2 rounded-xl bg-[#8E67C5] px-5 font-semibold shadow-[0_14px_45px_rgba(100,65,150,.3)] hover:bg-[#9C75D2]"><Plus className="h-4 w-4" />New project</button>
          <button type="button" disabled={loading} onClick={onOpen} className="inline-flex h-12 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-5 font-semibold hover:bg-white/[0.07]"><FolderOpen className="h-4 w-4" />Open project</button>
        </div>
        {error && <p className="mt-5 rounded-xl border border-red-300/15 bg-red-400/[0.05] px-4 py-3 text-sm text-red-100">{error}</p>}
        {recent.length > 0 && (
          <section className="mt-14 border-t border-white/[0.08] pt-6">
            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-[#687286]">Recent projects</p>
            <div className="grid gap-3 md:grid-cols-2">
              {recent.map((item) => <button key={item.folder} type="button" onClick={() => onRecent(item.folder)} className="group flex items-center justify-between rounded-2xl border border-white/[0.07] bg-[#11141B] p-4 text-left hover:border-white/[0.14]"><div><p className="font-semibold">{item.title}</p><p className="mt-1 truncate text-xs text-[#687286]">{item.folder}</p></div><ChevronRight className="h-4 w-4 text-[#596274] group-hover:text-white" /></button>)}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}

function AssetButton({ asset, icon: Icon, label, onChoose, onRemove }) {
  return (
    <div className="rounded-xl border border-white/[0.08] bg-[#0D1016] p-3">
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/[0.04]"><Icon className="h-4 w-4 text-[#B9A0DE]" /></span>
        <div className="min-w-0 flex-1"><p className="text-xs font-semibold text-[#DDE1E8]">{label}</p><p className={'mt-0.5 truncate text-xs ' + (asset?.available === false ? 'text-red-300' : 'text-[#687286]')}>{asset ? (asset.available === false ? 'Missing: ' : '') + asset.fileName : 'Not selected'}</p></div>
        <button type="button" onClick={onChoose} className="rounded-lg border border-white/[0.08] px-3 py-1.5 text-xs font-semibold hover:bg-white/[0.05]">{asset ? 'Replace' : 'Choose'}</button>
        {asset && <button type="button" onClick={onRemove} className="rounded-lg p-2 text-red-200 hover:bg-red-400/10"><Trash2 className="h-3.5 w-3.5" /></button>}
      </div>
    </div>
  );
}

export default function CourseStudio() {
  const [project, setProject] = useState(null);
  const projectRef = useRef(null);
  const [recent, setRecent] = useState([]);
  const [selection, setSelection] = useState({ type: 'course' });
  const [dirty, setDirty] = useState(0);
  const latestDirty = useRef(0);
  const [status, setStatus] = useState('Saved');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [validation, setValidation] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [exported, setExported] = useState(null);
  const [publication, setPublication] = useState(null);
  const [publishing, setPublishing] = useState('');

  useEffect(() => { listRecentProjects().then((result) => setRecent(result.projects)).catch(() => {}); }, []);
  useEffect(() => {
    const finishSaving = () => {
      if (!projectRef.current) return;
      try { saveProjectNow(projectRef.current); } catch {}
    };
    window.addEventListener('beforeunload', finishSaving);
    return () => window.removeEventListener('beforeunload', finishSaving);
  }, []);

  const acceptProject = useCallback((next) => {
    projectRef.current = next;
    setProject(next);
    setSelection({ type: 'course' });
    setStatus('Saved');
    setExported(null);
    setPublication(null);
  }, []);

  useEffect(() => {
    const catalogFolder = project?.publishing?.catalogFolder;
    if (!catalogFolder || !project?.course?.courseId) return undefined;
    let active = true;
    publishingStatus(catalogFolder, project.course.courseId)
      .then((result) => { if (active) setPublication(result.status); })
      .catch(() => { if (active) setPublication(null); });
    return () => { active = false; };
  }, [project?.course?.courseId, project?.projectId, project?.publishing?.catalogFolder]);

  const runOpen = async (action) => {
    setLoading(true); setError('');
    try { const result = await action(); if (!result.canceled) acceptProject(result.project); }
    catch (reason) { setError(reason.message); }
    finally { setLoading(false); }
  };

  const mutate = useCallback((change) => {
    const next = clone(projectRef.current);
    change(next);
    projectRef.current = next;
    setProject(next);
    latestDirty.current += 1;
    setDirty(latestDirty.current);
    setStatus('Unsaved changes');
  }, []);

  useEffect(() => {
    if (!dirty) return undefined;
    const version = dirty;
    const timer = window.setTimeout(async () => {
      setStatus('Saving…');
      try {
        const result = await saveProject(projectRef.current);
        if (latestDirty.current === version) {
          projectRef.current = result.project;
          setProject(result.project);
          setStatus('Saved');
        }
      } catch (reason) { setStatus('Save failed'); setError(reason.message); }
    }, 650);
    return () => window.clearTimeout(timer);
  }, [dirty]);

  const modules = project?.course.modules || [];
  const selectedModule = selection.moduleId ? modules.find((item) => item.id === selection.moduleId) : null;
  const selectedLesson = selection.lessonId ? selectedModule?.lessons.find((item) => item.id === selection.lessonId) : null;

  const move = (items, index, direction) => {
    const target = index + direction;
    if (target < 0 || target >= items.length) return;
    [items[index], items[target]] = [items[target], items[index]];
  };

  const addModule = () => mutate((draft) => {
    const module = { id: newId('module'), title: 'New module', description: '', lessons: [] };
    draft.course.modules.push(module); setSelection({ type: 'module', moduleId: module.id });
  });
  const addLesson = (moduleId) => mutate((draft) => {
    const module = draft.course.modules.find((item) => item.id === moduleId);
    const lesson = { id: newId('lesson'), title: 'New lesson', description: '', durationSeconds: 0, video: null, poster: null, captions: [] };
    module.lessons.push(lesson); setSelection({ type: 'lesson', moduleId, lessonId: lesson.id });
  });

  const choose = async (kind, apply) => {
    setError('');
    try {
      const result = await chooseAsset(project.projectId, kind);
      if (!result.canceled) {
        const next = clone(projectRef.current);
        apply(next, result.asset);
        setStatus('Saving…');
        const saved = await saveProject(next);
        projectRef.current = saved.project;
        setProject(saved.project);
        setStatus('Saved');
      }
    } catch (reason) { setError(reason.message); }
  };

  const runValidation = async () => {
    setError('');
    try {
      const result = await validateProject(projectRef.current);
      setValidation(result.validation);
      setExported(null);
    } catch (reason) { setError(reason.message); }
  };

  const runExport = async () => {
    setExporting(true); setError(''); setExported(null);
    try {
      const result = await exportPackage(projectRef.current);
      if (result.validation) setValidation(result.validation);
      if (result.exported) {
        setExported(result.exported);
        mutate((draft) => { draft.publishing.lastExportFolder = result.exported.folder; });
      }
    } catch (reason) { setError(reason.message); }
    finally { setExporting(false); }
  };

  const runPublishBeta = async () => {
    const packageFolder = exported?.folder || project.publishing.lastExportFolder;
    if (!packageFolder) { setError('Export the course package before publishing it.'); return; }
    setPublishing('beta'); setError('');
    try {
      const result = await publishBeta(packageFolder, project.publishing.catalogFolder);
      if (result.canceled) return;
      setPublication(result.publication.status);
      mutate((draft) => {
        draft.publishing.catalogFolder = result.publication.status.catalogFolder;
        draft.publishing.lastExportFolder = packageFolder;
      });
      setValidation(null); setExported(null);
    } catch (reason) { setError(reason.message); }
    finally { setPublishing(''); }
  };

  const runSetChannelVersion = async (version, channel) => {
    if (!project.publishing.catalogFolder || !version) return;
    setPublishing(channel + ':' + version); setError('');
    try {
      const result = await setChannelVersion(project.publishing.catalogFolder, project.course.courseId, version, channel);
      setPublication(result.publication.status);
    } catch (reason) { setError(reason.message); }
    finally { setPublishing(''); }
  };

  const previewLesson = useMemo(() => selectedLesson?.video?.previewUrl ? {
    id: selectedLesson.id, title: selectedLesson.title || 'Untitled lesson', durationSeconds: selectedLesson.durationSeconds,
    progressSeconds: 0, mediaUrl: selectedLesson.video.previewUrl, posterUrl: selectedLesson.poster?.previewUrl || '',
    captions: selectedLesson.captions.filter((item) => item.previewUrl).map((item) => ({ id: item.id, url: item.previewUrl, label: item.fileName.replace(/\.vtt$/i, ''), language: project.course.language })),
  } : null, [project, selectedLesson]);

  if (!project) return <Welcome error={error} loading={loading} recent={recent} onCreate={() => runOpen(createProject)} onOpen={() => runOpen(openProject)} onRecent={(folder) => runOpen(() => openRecentProject(folder))} />;

  return (
    <main className="min-h-screen bg-[#090B10] text-[#E9EBF0]">
      <header className="flex h-16 items-center justify-between border-b border-white/[0.07] bg-[#0C0F15] px-5">
        <div className="flex items-center gap-4"><button type="button" onClick={() => { try { saveProjectNow(projectRef.current); } catch {} setProject(null); projectRef.current = null; }} className="rounded-lg p-2 hover:bg-white/[0.06]"><ArrowLeft className="h-4 w-4" /></button><div><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#9E83C8]">BEX Course Studio</p><p className="text-sm font-semibold">{project.course.title || 'Untitled Course'}</p></div></div>
        <div className="flex items-center gap-3"><div className="flex items-center gap-2 text-xs text-[#7D8798]">{status === 'Saving…' ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : status === 'Saved' ? <Check className="h-3.5 w-3.5 text-emerald-300" /> : <Save className="h-3.5 w-3.5" />}{status}</div><button type="button" onClick={runValidation} className="h-9 rounded-lg border border-white/[0.09] px-3 text-xs font-semibold text-[#C9CFD8] hover:bg-white/[0.05]">Validate</button><button type="button" disabled={exporting} onClick={runExport} className="inline-flex h-9 items-center gap-2 rounded-lg bg-[#8E67C5] px-4 text-xs font-semibold text-white hover:bg-[#9B73D0] disabled:opacity-60">{exporting ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <PackageCheck className="h-3.5 w-3.5" />}Export package</button></div>
      </header>
      {error && <div className="border-b border-red-300/10 bg-red-400/[0.05] px-5 py-2 text-center text-xs text-red-100">{error}</div>}
      <div className="grid min-h-[calc(100vh-4rem)] grid-cols-[300px_minmax(420px,1fr)_minmax(360px,.9fr)]">
        <aside className="border-r border-white/[0.07] bg-[#0C0F15] p-4">
          <button type="button" onClick={() => setSelection({ type: 'course' })} className={'mb-4 flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left ' + (selection.type === 'course' ? 'bg-[#241B31] text-white' : 'text-[#99A2B1] hover:bg-white/[0.04]')}><Clapperboard className="h-4 w-4" /><span className="font-semibold">Course details</span></button>
          <div className="mb-3 flex items-center justify-between px-2"><span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#606A7C]">Outline</span><button type="button" onClick={addModule} className="rounded-lg p-1.5 hover:bg-white/[0.06]" aria-label="Add module"><Plus className="h-4 w-4" /></button></div>
          <div className="space-y-2">
            {modules.map((module, moduleIndex) => <div key={module.id} className="rounded-xl border border-white/[0.06] bg-[#11141B] p-2">
              <div className="group flex items-center gap-1"><button type="button" onClick={() => setSelection({ type: 'module', moduleId: module.id })} className={'min-w-0 flex-1 truncate rounded-lg px-2 py-2 text-left text-sm font-semibold ' + (selection.type === 'module' && selection.moduleId === module.id ? 'bg-[#2B2039] text-white' : 'text-[#CDD2DA] hover:bg-white/[0.04]')}>{module.title || 'Untitled module'}</button><MoveButtons index={moduleIndex} length={modules.length} onMove={(direction) => mutate((draft) => move(draft.course.modules, moduleIndex, direction))} onRemove={() => { if (confirm('Remove this module and its lessons?')) mutate((draft) => { draft.course.modules.splice(moduleIndex, 1); setSelection({ type: 'course' }); }); }} /></div>
              <div className="ml-3 mt-1 space-y-1 border-l border-white/[0.07] pl-2">{module.lessons.map((lesson, lessonIndex) => <div key={lesson.id} className="group flex items-center gap-1"><button type="button" onClick={() => setSelection({ type: 'lesson', moduleId: module.id, lessonId: lesson.id })} className={'min-w-0 flex-1 truncate rounded-lg px-2 py-1.5 text-left text-xs ' + (selection.lessonId === lesson.id ? 'bg-[#251D31] text-[#E9DFF5]' : 'text-[#7F899A] hover:text-white')}>{lesson.title || 'Untitled lesson'}</button><MoveButtons index={lessonIndex} length={module.lessons.length} onMove={(direction) => mutate((draft) => move(draft.course.modules[moduleIndex].lessons, lessonIndex, direction))} onRemove={() => { if (confirm('Remove this lesson?')) mutate((draft) => { draft.course.modules[moduleIndex].lessons.splice(lessonIndex, 1); setSelection({ type: 'module', moduleId: module.id }); }); }} /></div>)}<button type="button" onClick={() => addLesson(module.id)} className="flex items-center gap-1 px-2 py-1.5 text-xs font-semibold text-[#876FA9] hover:text-[#C4ABE7]"><Plus className="h-3 w-3" />Lesson</button></div>
            </div>)}
          </div>
        </aside>

        <section className="overflow-y-auto p-8">
          <AnimatePresence mode="wait"><motion.div key={selection.type + (selection.moduleId || '') + (selection.lessonId || '')} initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} className="mx-auto max-w-2xl space-y-6">
            {selection.type === 'course' && <><div><p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#9578BD]">Course</p><h1 className="mt-2 text-3xl font-semibold">Course details</h1></div><Field label="Title" value={project.course.title} onChange={(value) => mutate((draft) => { draft.course.title = value; })} /><Field label="Description" multiline value={project.course.description} onChange={(value) => mutate((draft) => { draft.course.description = value; })} /><div className="grid grid-cols-2 gap-4"><Field label="Author" value={project.course.author} onChange={(value) => mutate((draft) => { draft.course.author = value; })} /><Field label="Version" value={project.course.version} onChange={(value) => mutate((draft) => { draft.course.version = value; })} /></div><AssetButton asset={project.course.artwork} icon={Image} label="Course thumbnail" onChoose={() => choose('artwork', (draft, asset) => { draft.course.artwork = asset; })} onRemove={() => mutate((draft) => { draft.course.artwork = null; })} /></>}
            {selection.type === 'module' && selectedModule && <><div><p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#9578BD]">Module</p><h1 className="mt-2 text-3xl font-semibold">{selectedModule.title || 'Untitled module'}</h1></div><Field label="Module title" value={selectedModule.title} onChange={(value) => mutate((draft) => { draft.course.modules.find((item) => item.id === selectedModule.id).title = value; })} /><Field label="Description" multiline value={selectedModule.description} onChange={(value) => mutate((draft) => { draft.course.modules.find((item) => item.id === selectedModule.id).description = value; })} /><button type="button" onClick={() => addLesson(selectedModule.id)} className="inline-flex items-center gap-2 rounded-xl bg-[#8E67C5] px-4 py-2.5 text-sm font-semibold"><Plus className="h-4 w-4" />Add lesson</button></>}
            {selection.type === 'lesson' && selectedLesson && <><div><p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#9578BD]">Lesson</p><h1 className="mt-2 text-3xl font-semibold">{selectedLesson.title || 'Untitled lesson'}</h1></div><Field label="Lesson title" value={selectedLesson.title} onChange={(value) => mutate((draft) => { draft.course.modules.find((item) => item.id === selectedModule.id).lessons.find((item) => item.id === selectedLesson.id).title = value; })} /><Field label="Description" multiline value={selectedLesson.description} onChange={(value) => mutate((draft) => { draft.course.modules.find((item) => item.id === selectedModule.id).lessons.find((item) => item.id === selectedLesson.id).description = value; })} /><AssetButton asset={selectedLesson.video} icon={FileVideo} label="Finished MP4 video" onChoose={() => choose('video', (draft, asset) => { draft.course.modules.find((item) => item.id === selectedModule.id).lessons.find((item) => item.id === selectedLesson.id).video = asset; })} onRemove={() => mutate((draft) => { draft.course.modules.find((item) => item.id === selectedModule.id).lessons.find((item) => item.id === selectedLesson.id).video = null; })} /><AssetButton asset={selectedLesson.poster} icon={Image} label="Lesson thumbnail" onChoose={() => choose('poster', (draft, asset) => { draft.course.modules.find((item) => item.id === selectedModule.id).lessons.find((item) => item.id === selectedLesson.id).poster = asset; })} onRemove={() => mutate((draft) => { draft.course.modules.find((item) => item.id === selectedModule.id).lessons.find((item) => item.id === selectedLesson.id).poster = null; })} /><AssetButton asset={selectedLesson.captions[0]} icon={Captions} label="Offline captions (WebVTT)" onChoose={() => choose('caption', (draft, asset) => { draft.course.modules.find((item) => item.id === selectedModule.id).lessons.find((item) => item.id === selectedLesson.id).captions = [asset]; })} onRemove={() => mutate((draft) => { draft.course.modules.find((item) => item.id === selectedModule.id).lessons.find((item) => item.id === selectedLesson.id).captions = []; })} /></>}
          </motion.div></AnimatePresence>
        </section>

        <aside className="overflow-y-auto border-l border-white/[0.07] bg-[#0C0F15] p-6"><div className="mb-5 flex items-center gap-2"><Layers3 className="h-4 w-4 text-[#AE91D5]" /><p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#8B95A6]">Learner preview</p></div>{previewLesson ? <CoursePlayer course={{ id: project.course.courseId, title: project.course.title }} lesson={previewLesson} onClose={() => {}} saveProgress={async () => ({})} showClose={false} /> : <div className="flex aspect-video flex-col items-center justify-center rounded-2xl border border-dashed border-white/[0.1] bg-[#090B10] px-6 text-center"><FileVideo className="mb-3 h-7 w-7 text-[#67577C]" /><p className="text-sm font-semibold text-[#C9CED7]">Select a finished lesson video</p><p className="mt-1 text-xs leading-5 text-[#606A7B]">Studio previews the original file without moving or editing it.</p></div>}{project.course.artwork?.previewUrl && selection.type === 'course' && <img src={project.course.artwork.previewUrl} alt="Course thumbnail preview" className="mt-5 aspect-video w-full rounded-2xl border border-white/[0.08] object-cover" />}</aside>
      </div>
      {(project.publishing.lastExportFolder || publication) && <section className="fixed bottom-5 right-5 z-30 w-[360px] rounded-2xl border border-white/[0.1] bg-[#11141B]/95 p-4 shadow-[0_24px_80px_rgba(0,0,0,.48)] backdrop-blur-xl"><div className="flex items-start justify-between gap-4"><div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#9E83C8]">Local publishing</p><p className="mt-1 text-sm font-semibold text-white">Test the real release flow</p></div><FolderOpen className="h-4 w-4 text-[#786690]" /></div><div className="mt-3 flex gap-2 text-xs"><span className="rounded-lg bg-white/[0.04] px-2.5 py-1.5 text-[#A9B1BE]">Beta <b className="ml-1 text-white">{publication?.betaVersion || '—'}</b></span><span className="rounded-lg bg-white/[0.04] px-2.5 py-1.5 text-[#A9B1BE]">Stable <b className="ml-1 text-white">{publication?.stableVersion || '—'}</b></span></div><button type="button" onClick={runPublishBeta} disabled={Boolean(publishing)} className="mt-3 inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-[#8E67C5] text-sm font-semibold text-white hover:bg-[#9B73D0] disabled:opacity-55">{publishing === 'beta' ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <PackageCheck className="h-4 w-4" />}Publish export to Beta</button>{publication?.betaVersion && publication.betaVersion !== publication.stableVersion && <button type="button" onClick={() => runSetChannelVersion(publication.betaVersion, 'stable')} disabled={Boolean(publishing)} className="mt-2 h-10 w-full rounded-xl border border-emerald-300/20 bg-emerald-400/[0.06] text-sm font-semibold text-emerald-100 hover:bg-emerald-400/[0.1] disabled:opacity-55">Promote Beta {publication.betaVersion} to Stable</button>}{publication?.versions?.length > 1 && <div className="mt-3 border-t border-white/[0.07] pt-3"><p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.15em] text-[#687286]">Rollback Stable</p><div className="flex flex-wrap gap-2">{publication.versions.filter((version) => version !== publication.stableVersion).map((version) => <button key={version} type="button" onClick={() => runSetChannelVersion(version, 'stable')} disabled={Boolean(publishing)} className="rounded-lg border border-white/[0.08] px-2.5 py-1.5 text-xs text-[#AEB6C3] hover:bg-white/[0.05] disabled:opacity-55">Use {version}</button>)}</div></div>}<p className="mt-3 truncate text-[10px] text-[#596274]" title={publication?.catalogFolder || project.publishing.catalogFolder}>{publication?.catalogFolder || project.publishing.catalogFolder || 'Choose the catalog folder when publishing'}</p></section>}
      <AnimatePresence>
        {(validation || exported) && <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget) { setValidation(null); setExported(null); } }}><motion.section initial={{ opacity: 0, scale: .98, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }} className="max-h-[78vh] w-full max-w-xl overflow-y-auto rounded-3xl border border-white/[0.1] bg-[#11141B] p-6 shadow-2xl"><div className="flex items-start justify-between gap-4"><div className="flex items-start gap-3">{exported || validation?.valid ? <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-400/10"><CheckCircle2 className="h-5 w-5 text-emerald-300" /></span> : <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-400/10"><AlertTriangle className="h-5 w-5 text-amber-200" /></span>}<div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#8F79AD]">Course check</p><h2 className="mt-1 text-2xl font-semibold text-white">{exported ? 'Package exported' : validation?.valid ? 'Ready to export' : 'A few things need attention'}</h2></div></div><button type="button" onClick={() => { setValidation(null); setExported(null); }} className="rounded-lg p-2 text-[#778195] hover:bg-white/[0.06] hover:text-white"><X className="h-4 w-4" /></button></div>{exported && <div className="mt-5 rounded-xl border border-emerald-300/15 bg-emerald-400/[0.05] p-4"><p className="text-sm font-semibold text-emerald-100">Installable package created</p><p className="mt-1 break-all text-xs leading-5 text-[#91A09A]">{exported.folder}</p><p className="mt-2 text-xs text-[#718078]">{exported.assetCount} files · Source media unchanged</p></div>}{validation?.errors?.length > 0 && <div className="mt-5 space-y-2">{validation.errors.map((item, index) => <div key={item.code + index} className="rounded-xl border border-red-300/10 bg-red-400/[0.04] px-4 py-3"><p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-red-300/70">{item.location}</p><p className="mt-1 text-sm text-red-100">{item.message}</p></div>)}</div>}{validation?.warnings?.length > 0 && <div className="mt-5"><p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-amber-200/70">Warnings</p><div className="space-y-2">{validation.warnings.map((item, index) => <p key={item.code + index} className="rounded-xl bg-white/[0.035] px-4 py-3 text-sm text-[#AAB2BF]">{item.message}</p>)}</div></div>}{validation?.valid && !exported && <button type="button" onClick={runExport} disabled={exporting} className="mt-6 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#8E67C5] font-semibold text-white"><PackageCheck className="h-4 w-4" />Choose export location</button>}</motion.section></motion.div>}
      </AnimatePresence>
    </main>
  );
}
