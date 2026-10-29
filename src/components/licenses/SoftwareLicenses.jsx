import React, { useEffect, useState } from 'react';
import ExternalWebLink from '@/components/navigation/ExternalWebLink';

const fileLinkClass = 'text-brand underline underline-offset-2 hover:text-brand-strong';
const textClass = 'max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-xl border border-line bg-app p-4 font-mono text-xs leading-relaxed text-ink-muted';

// Mounted only on Sources & Licenses. No global dialogs, banners or notices.
export default function SoftwareLicenses() {
  const [manifest, setManifest] = useState(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setError('');
    fetch('/licenses/manifest.json', { signal: controller.signal, cache: 'no-cache' })
      .then(async response => {
        if (!response.ok) throw new Error(`License files could not be loaded (${response.status}).`);
        const data = await response.json();
        if (data.schemaVersion !== 1 || !Array.isArray(data.runtime) || !Array.isArray(data.groups)) throw new Error('The bundled license inventory is invalid.');
        if (!controller.signal.aborted) setManifest(data);
      })
      .catch(reason => { if (!controller.signal.aborted) setError(reason.message || 'License files could not be loaded.'); });
    return () => controller.abort();
  }, [attempt]);

  return <section className="space-y-5" aria-labelledby="software-licenses-heading">
    <div>
      <h2 id="software-licenses-heading" className="text-xl font-semibold text-gray-900 dark:text-white">Application runtime & npm licenses</h2>
      <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Bundled license texts and package-specific copyright notices, available offline.</p>
    </div>
    {error ? <div role="alert" className="rounded-xl border border-line p-4 text-sm">
      <p>{error}</p><button type="button" className={fileLinkClass} onClick={() => setAttempt(value => value + 1)}>Retry loading license files</button>
    </div> : !manifest ? <p role="status" className="text-sm text-ink-muted">Loading bundled licenses…</p> : <>
      <div className="space-y-3" aria-label="Electron runtime licenses">
        {manifest.runtime.map(item => <details key={item.name} className="rounded-2xl border border-line bg-surface p-5">
          <summary className="cursor-pointer text-sm font-semibold text-ink">
            {item.name}{item.version && ` ${item.version}`} <span className="ml-2 font-normal text-ink-muted">{item.license}</span>
          </summary>
          <div className="mt-4 space-y-3 text-sm">
            {item.note && <p className="whitespace-pre-wrap break-words leading-relaxed text-ink-muted">{item.note}</p>}
            {item.file ? <>
              <a className={fileLinkClass} href={item.file} download="LICENSES.chromium.html">Download bundled LICENSES.chromium.html</a>
              <p className="text-xs text-ink-muted">The complete original file is shown below. It is bundled separately from this page.</p>
              <iframe title="Complete Chromium third-party licenses" src={item.file} sandbox="" referrerPolicy="no-referrer" loading="lazy" style={{ colorScheme: 'light' }} className="h-96 w-full rounded-xl border border-line bg-white" />
            </> : <pre className={textClass}>{item.text}</pre>}
            <div className="flex flex-wrap gap-4">
              {(item.links || [{ label: 'Upstream source', url: item.source }]).map(link => <ExternalWebLink key={link.url} href={link.url} className={fileLinkClass}>{link.label}</ExternalWebLink>)}
            </div>
          </div>
        </details>)}
      </div>

      <div className="space-y-3">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">npm dependencies by license</h3>
        <p className="text-sm leading-relaxed text-ink-muted">{manifest.packageCount} installed packages. {manifest.scope}</p>
        <p className="text-sm leading-relaxed text-ink-muted">Each license type appears once below. Packages that require two licenses appear in both lists. Where alternatives are offered, the selected license and the original declaration are recorded. All original notices, including package-specific variations and additional terms, remain in the bundled file.</p>
        <a className={`inline-block text-sm ${fileLinkClass}`} href={manifest.originalNoticesFile} download="npm-original-notices.txt">Download all original npm license and copyright notices</a>
        {manifest.groups.map(group => <details key={group.license} className="rounded-2xl border border-line bg-surface p-5">
          <summary className="cursor-pointer text-sm font-semibold text-ink">{group.license} <span className="ml-2 font-normal text-ink-muted">{group.packages.length} packages</span></summary>
          <div className="mt-4 space-y-4">
            <pre aria-label={`${group.license} license text`} className={textClass}>{group.text}</pre>
            <ul aria-label={`${group.license} packages`} className="max-h-96 space-y-3 overflow-auto text-xs leading-relaxed text-ink-muted">
              {group.packages.map(pkg => <li key={pkg.path} className="border-t border-line pt-3">
                <span className="font-semibold text-ink">{pkg.name}@{pkg.version}</span>
                {pkg.declaredLicense !== group.license && <p>Declared: {pkg.declaredLicense}. Used by BEX: {pkg.licenses.join(' AND ')}.</p>}
                {pkg.copyright.map((notice, index) => <p key={index} className="whitespace-pre-wrap break-words">{notice}</p>)}
                {!pkg.copyright.length && pkg.author && <p>Author (package metadata): {pkg.author}</p>}
              </li>)}
            </ul>
          </div>
        </details>)}
      </div>

      <details className="rounded-2xl border border-line bg-surface p-5">
        <summary className="cursor-pointer text-sm font-semibold text-ink">License review flags ({manifest.issues.length})</summary>
        <p className="mt-3 text-sm text-ink-muted">GPL and AGPL declarations are flagged even when a permissive alternative is selected. Other nonstandard conditions and missing upstream notices are also listed.</p>
        {manifest.issues.length ? <ul className="mt-4 space-y-3 text-sm text-ink-muted">{manifest.issues.map((issue, index) => <li key={index}><strong className="text-ink">{issue.package}</strong> — {issue.message}</li>)}</ul> : <p className="mt-3 text-sm text-ink-muted">No GPL or AGPL declarations found in the included npm inventory.</p>}
      </details>
    </>}
  </section>;
}
