import React from 'react';
import { useInRouterContext, useNavigate } from 'react-router-dom';
import * as Dialog from '@radix-ui/react-dialog';
import { ArrowRight, BookOpen, Check, KeyRound, Loader2, LockKeyhole, RotateCw, ShieldCheck, X } from 'lucide-react';
import ExternalWebLink from '@/components/navigation/ExternalWebLink';
import Card3DTilt from '@/components/shaders/Card3DTilt';
import { restartBex } from '@/lib/restartBex';
import {
  clearScriptureKey, getScriptureSetup, saveScriptureKey, SCRIPTURE_SETUP_CHANGED_EVENT,
} from '@/lib/scriptureSetup';
import { useOptionalWorkspaceTabs, TAB_KINDS } from '@/lib/WorkspaceTabs';
import { useFavoriteBible } from '@/lib/favoriteBible';
import './scriptureSearch.css';
import freeUseBibleLogo from './free-use-bible-api.png';

function ScriptureMist() {
  return (
    <span className="scripture-search__aura" aria-hidden="true">
      {[0, 1, 2, 3].map((i) => <span key={`wisp-${i}`} className="scripture-search__wisp" style={{ left: `${8 + i * 23}%`, '--delay': `${-i * 1.3}s` }} />)}
      {Array.from({ length: 16 }, (_, i) => (
        <span key={i} className="scripture-search__particle" style={{
          left: `${4 + i * 6}%`, top: `${18 + (i * 19) % 72}%`,
          '--delay': `${-i * .47}s`, '--duration': `${2.8 + (i % 4) * .45}s`,
          '--drift': `${(i % 2 ? -1 : 1) * (16 + (i % 3) * 8)}px`,
          '--particle-size': `${i % 3 === 0 ? 3 : 2}px`,
        }} />
      ))}
    </span>
  );
}

function RouterNavigator({ navRef }) {
  const navigate = useNavigate();
  React.useEffect(() => {
    navRef.current = navigate;
  }, [navigate, navRef]);
  return null;
}

export default function ScriptureSearch({ onSearch, initialQuery = '', className = '', showSearchIcon = true } = {}) {
  const inRouter = useInRouterContext();
  const navRef = React.useRef(null);
  const workspaceTabs = useOptionalWorkspaceTabs();
  const [favoriteBible] = useFavoriteBible();
  const [configured, setConfigured] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [key, setKey] = React.useState('');
  const [query, setQuery] = React.useState(initialQuery || '');

  React.useEffect(() => {
    if (initialQuery !== undefined) {
      setQuery(initialQuery || '');
    }
  }, [initialQuery]);

  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [message, setMessage] = React.useState('');
  const [error, setError] = React.useState('');
  const [restartNeeded, setRestartNeeded] = React.useState(false);
  const [restarting, setRestarting] = React.useState(false);
  const rootRef = React.useRef(null);
  const inputRef = React.useRef(null);
  const searchRef = React.useRef(null);
  const triggerRef = React.useRef(null);
  const savingRef = React.useRef(false);
  const messageId = React.useId();
  const keyInputId = React.useId();
  const errorId = React.useId();

  React.useEffect(() => {
    let active = true;
    let changedSinceRead = false;
    setError('');
    getScriptureSetup().then((status) => {
      if (active && !changedSinceRead) setConfigured(status.configured);
    }).catch(() => {
      // A passive startup probe must not open an error popup. A renderer may
      // be newer than its running desktop process; submitting a key gives an
      // actionable message if setup is still unavailable.
    }).finally(() => { if (active) setLoading(false); });
    const changed = (event) => {
      changedSinceRead = true;
      setLoading(false);
      setConfigured(event.detail?.configured === true);
      setKey('');
      setSettingsOpen(false);
      setError('');
    };
    window.addEventListener(SCRIPTURE_SETUP_CHANGED_EVENT, changed);
    return () => {
      active = false;
      window.removeEventListener(SCRIPTURE_SETUP_CHANGED_EVENT, changed);
    };
  }, []);

  React.useEffect(() => {
    if (settingsOpen && !loading) inputRef.current?.focus();
  }, [settingsOpen, loading]);

  React.useEffect(() => {
    const outside = (event) => {
      if (!rootRef.current?.contains(event.target)) {
        setMessage('');
      }
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, []);

  async function submit(event) {
    event.preventDefault();
    if (loading || savingRef.current) return;
    const clean = key.trim();
    if (!clean || clean.length > 512 || !/^[\x21-\x7e]+$/.test(clean)) {
      setError('Paste an API key without spaces, then press Enter.');
      return;
    }
    savingRef.current = true;
    setBusy(true);
    setError('');
    try {
      await saveScriptureKey(clean);
      setMessage('API key saved securely. Scripture search is coming next.');
    } catch (failure) {
      setError(failure.message);
      setRestartNeeded(failure.code === 'BEX_RESTART_REQUIRED');
    } finally {
      setKey('');
      savingRef.current = false;
      setBusy(false);
    }
  }

  async function removeKey() {
    if (savingRef.current) return;
    savingRef.current = true;
    setBusy(true);
    setError('');
    try {
      await clearScriptureKey();
      setQuery('');
      setMessage('');
    } catch (failure) {
      setError(failure.message);
    } finally {
      savingRef.current = false;
      setBusy(false);
    }
  }

  function setDialogOpen(open) {
    if (savingRef.current) return;
    setSettingsOpen(open);
    setKey('');
    setError('');
    setRestartNeeded(false);
    setMessage('');
  }

  async function restart() {
    if (savingRef.current) return;
    savingRef.current = true;
    setBusy(true);
    setRestarting(true);
    setKey('');
    try {
      await restartBex();
      // Keep the modal inert while the main process finishes its backup and
      // closes this renderer. No second click can queue another app instance.
    } catch (failure) {
      setError(failure.message);
      savingRef.current = false;
      setBusy(false);
      setRestarting(false);
    }
  }

  return (
    <Dialog.Root open={settingsOpen} onOpenChange={setDialogOpen}>
      {inRouter && <RouterNavigator navRef={navRef} />}
      <div ref={rootRef} className={`scripture-search ${className}`} data-testid="scripture-search" data-locked={!configured} aria-busy={loading}>
        {!configured ? (
          <>
            <ScriptureMist />
            <Dialog.Trigger asChild>
              <button ref={triggerRef} type="button" className="scripture-search__bar scripture-search__bar--locked scripture-search__unlock">
                <LockKeyhole className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span className="scripture-search__label">unlock scripture reading here</span>
                <ArrowRight className="ml-auto h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              </button>
            </Dialog.Trigger>
          </>
        ) : (
          <form className="scripture-search__bar" aria-label="Scripture search" onSubmit={(event) => {
            event.preventDefault();
            if (event.nativeEvent?.isComposing) return;
            const clean = query.trim();
            if (!clean) return;
            if (onSearch) {
              onSearch(clean);
            }
            const targetPath = `/Study?q=${encodeURIComponent(clean)}${!onSearch && favoriteBible ? `&version=${encodeURIComponent(`API:${favoriteBible.id}`)}` : ''}`;
            if (workspaceTabs) {
              const { tabs, activeTab, openTab, updateTab, selectTab } = workspaceTabs;
              const patch = {
                kind: TAB_KINDS.STUDY,
                path: targetPath,
                title: clean,
              };
              if (activeTab?.kind === TAB_KINDS.HOME || activeTab?.kind === TAB_KINDS.STUDY) {
                updateTab(activeTab.id, patch);
              } else {
                const existing = tabs.find((t) => t.path.startsWith('/Study?q='));
                if (existing) {
                  updateTab(existing.id, patch);
                  selectTab(existing.id);
                } else {
                  openTab(TAB_KINDS.STUDY, patch);
                }
              }
              if (navRef.current) {
                navRef.current(targetPath);
              }
            } else if (navRef.current) {
              navRef.current(targetPath);
            } else {
              setMessage('Your API key is saved. Scripture search is coming next.');
            }
          }}>
            {showSearchIcon && <BookOpen className="h-4 w-4 shrink-0" aria-hidden="true" />}
            <input ref={searchRef} type="search" value={query} maxLength={200} onChange={(event) => { setQuery(event.target.value); setMessage(''); }} onKeyDown={(event) => {
              if (event.key === 'Escape') { setMessage(''); searchRef.current?.blur(); }
            }} placeholder="Search scripture…" aria-label="Search scripture" aria-describedby={message ? messageId : undefined} className="min-w-0 flex-1 border-0 bg-transparent text-sm outline-none" />
            <Dialog.Trigger asChild>
              <button ref={triggerRef} type="button" aria-label="Manage scripture API key" title="API key saved · Manage key" className="scripture-search__button"><KeyRound className="h-3.5 w-3.5" /></button>
            </Dialog.Trigger>
          </form>
        )}
        {message && <div id={messageId} className="scripture-search__popover">
          <div className="flex items-start gap-2">
            <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-violet-300" />
            <p className="flex-1 text-xs leading-relaxed" role="status">{message}</p>
            <button type="button" aria-label="Dismiss scripture setup message" className="text-slate-500 hover:text-white" onClick={() => setMessage('')}><X className="h-3.5 w-3.5" /></button>
          </div>
        </div>}
      </div>
      <Dialog.Portal>
        <Dialog.Overlay className="scripture-key__veil" />
        <Dialog.Content className="scripture-key__dialog" onOpenAutoFocus={(event) => { event.preventDefault(); inputRef.current?.focus(); }} onCloseAutoFocus={(event) => {
          event.preventDefault(); (configured ? searchRef.current : triggerRef.current)?.focus({ preventScroll: true });
        }} onEscapeKeyDown={(event) => { if (savingRef.current) event.preventDefault(); }} onPointerDownOutside={(event) => { if (savingRef.current) event.preventDefault(); }}>
          <Card3DTilt
            appearance="transparent"
            className="scripture-key__card"
            tiltClassName="scripture-key__surface"
            innerClassName="scripture-key__content"
            glowAppearance="none"
            maxTiltDeg={10}
          >
            <div className="scripture-key__hero">
              <img className="scripture-key__logo" src={freeUseBibleLogo} alt="Free Use Bible API logo" />
              <Dialog.Title className="scripture-key__title"><ExternalWebLink href="https://bible.helloao.org/docs/?ref=faith.tools">Free Use Bible API</ExternalWebLink></Dialog.Title>
              <Dialog.Description className="sr-only">Enter your API key.</Dialog.Description>
            </div>
            <form onSubmit={submit} aria-label="Scripture search setup" aria-busy={loading || busy} className="scripture-key__form">
              <label htmlFor={keyInputId} className="scripture-key__label">{configured ? 'Replacement API key' : 'API key'}</label>
              <div className="scripture-key__field">
                <LockKeyhole className="h-4 w-4 shrink-0" aria-hidden="true" />
                <input id={keyInputId} ref={inputRef} type="password" value={key} disabled={loading || busy} maxLength={512} onChange={(event) => { setKey(event.target.value); setError(''); }} placeholder="paste your api key here" aria-label="API.Bible API key" aria-invalid={Boolean(error)} aria-describedby={error ? errorId : undefined} autoComplete="off" autoCapitalize="none" spellCheck={false} />
              </div>
              {error && <div className="scripture-key__recovery">
                <p id={errorId} role="alert" className="scripture-key__error">{error}</p>
                {restartNeeded && <button type="button" onClick={restart} disabled={busy} className="scripture-key__restart">
                  {restarting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <RotateCw className="h-4 w-4" aria-hidden="true" />}
                  {restarting ? 'Saving & restarting…' : 'Restart BEX'}
                </button>}
              </div>}
              {configured && <p className="scripture-key__hint">Your saved key is never displayed. Paste a new key to replace it.</p>}
              <button type="submit" disabled={loading || busy || !key.trim()} aria-label="Save API key" className="scripture-key__submit">
                {busy && !restarting ? <><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Securing your key…</> : <>{configured ? 'Save replacement' : 'Save API key'}<ArrowRight className="h-4 w-4" aria-hidden="true" /></>}
              </button>
            </form>
            <div className="scripture-key__footer"><ShieldCheck className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /><span>Encrypted on this device.</span>{configured && <button type="button" disabled={busy} onClick={removeKey}>Remove saved key</button>}</div>
            <Dialog.Close asChild><button type="button" disabled={busy} className="scripture-key__close" aria-label="Close scripture setup"><X className="h-4 w-4" /></button></Dialog.Close>
          </Card3DTilt>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
