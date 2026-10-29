import React from 'react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import SourcesLicenses from '@/pages/SourcesLicenses';
import { collectLicenseAssets } from '../../tools/vite-license-assets.mjs';

const { manifest } = collectLicenseAssets();
function mount() { return render(<MemoryRouter><SourcesLicenses /></MemoryRouter>); }
beforeEach(() => { vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => manifest }))); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('software notices on the dedicated licenses page', () => {
  it('loads the local inventory, retains Bible notices, and groups npm packages under one text per type', async () => {
    mount();
    await screen.findByText('npm dependencies by license');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toBe('/licenses/manifest.json');
    expect(screen.getByRole('heading', { name: 'Bible Text Sources' })).toBeTruthy();
    expect(screen.getByText(`${manifest.packageCount} installed packages.`, { exact: false })).toBeTruthy();
    for (const group of manifest.groups) expect(screen.getAllByLabelText(`${group.license} license text`)).toHaveLength(1);
    const mit = screen.getByLabelText('MIT packages');
    expect(mit.textContent).toContain('react@');
    expect(mit.textContent).toContain('jszip@3.10.1');
    expect(mit.textContent).toContain('Meta Platforms');
    expect(screen.getByRole('link', { name: 'Download all original npm license and copyright notices' }).getAttribute('href')).toBe('/licenses/npm-original-notices.txt');
  });

  it('references the complete Chromium file through a sandboxed local viewer and download', async () => {
    mount();
    const download = await screen.findByText('Download bundled LICENSES.chromium.html');
    expect(download.getAttribute('href')).toBe('/licenses/LICENSES.chromium.html');
    expect(download.hasAttribute('download')).toBe(true);
    const frame = screen.getByTitle('Complete Chromium third-party licenses');
    expect(frame.getAttribute('src')).toBe('/licenses/LICENSES.chromium.html');
    expect(frame.getAttribute('sandbox')).toBe('');
    expect(frame.style.colorScheme).toBe('light');
    expect(frame.getAttribute('srcdoc')).toBeNull();
    expect(document.querySelector('.product')).toBeNull();
  });

  it('preserves exact upstream runtime text, source links and GPL alternative flags', async () => {
    mount();
    await screen.findByText('npm dependencies by license');
    expect(screen.getByText('Squirrel.Mac', { exact: false, selector: 'summary' }).closest('details').textContent).toContain('distributed under the MIT license');
    expect(screen.getByRole('link', { name: 'Pinned dependencies and revisions' }).getAttribute('href')).toBe(`https://github.com/electron/electron/blob/v${manifest.electronVersion}/DEPS`);
    expect(screen.getByText('GPL alternative declared;', { exact: false })).toBeTruthy();
    expect(screen.getAllByText('Hippocratic-2.1 includes additional use conditions;', { exact: false })).toHaveLength(2);
    expect(document.body.textContent).toContain('GNU LESSER GENERAL PUBLIC LICENSE');
  });

  it('offers a retry for missing local documents rather than claiming notices loaded', async () => {
    fetch.mockResolvedValueOnce({ ok: false, status: 404 });
    mount();
    expect((await screen.findByRole('alert')).textContent).toContain('404');
    expect(screen.queryByText('npm dependencies by license')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry loading license files' }));
    await screen.findByText('npm dependencies by license');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('does not set state or surface an error when navigation aborts a load', async () => {
    fetch.mockImplementationOnce((_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    }));
    const view = mount();
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    const signal = fetch.mock.calls[0][1].signal;
    view.unmount();
    expect(signal.aborted).toBe(true);
  });
});
