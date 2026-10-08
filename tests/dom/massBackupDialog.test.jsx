import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import MassBackupDialog from '@/components/library/MassBackupDialog';

const inventory = {
  web: 4,
  note: [{ id: 1 }, { id: 2 }, { id: 3 }],
  timeline: { count: 2 },
};

const settings = {
  folderPath: '/Users/david/Backups/Berean',
  replacePrevious: false,
};

function renderDialog(overrides = {}) {
  const props = {
    open: true,
    inventory,
    settings,
    stage: 'ready',
    onClose: vi.fn(),
    onChooseFolder: vi.fn(),
    onReplacePreviousChange: vi.fn(),
    onRetry: vi.fn(),
    onStart: vi.fn(),
    onRevealFolder: vi.fn(),
    ...overrides,
  };
  render(<MassBackupDialog {...props} />);
  return props;
}

describe('MassBackupDialog', () => {
  it('shows every automatically selected category while explicitly excluding chapters', () => {
    const props = renderDialog();

    expect(screen.getByTestId('mass-backup-dialog')).toBeTruthy();
    expect(screen.getByTestId('mass-backup-count-web').textContent).toContain('4');
    expect(screen.getByTestId('mass-backup-count-web').textContent).toContain('.berean');
    expect(screen.getByTestId('mass-backup-count-note').textContent).toContain('3');
    expect(screen.getByTestId('mass-backup-count-note').textContent).toContain('.md');
    expect(screen.getByTestId('mass-backup-count-timeline').textContent).toContain('2');
    expect(screen.getByTestId('mass-backup-count-timeline').textContent).toContain('.json');
    expect(screen.getByTestId('mass-backup-count-web').parentElement.className).toContain('grid-cols-1');
    expect(screen.getByTestId('mass-backup-count-web').parentElement.className).toContain('min-[360px]:grid-cols-3');
    expect(screen.getByText(/Bible studies and chapters are excluded/i)).toBeTruthy();
    expect(screen.getByTestId('mass-backup-destination').textContent).toBe(settings.folderPath);
    expect(screen.getByTestId('mass-backup-start').textContent).toContain('Back up 9 items');
    expect(screen.queryByText('3 archive types')).toBeNull();
    expect(screen.queryByText(/Back up every Knowledge Web, note, and timeline/i)).toBeNull();
    expect(screen.queryByText('Automatically selected')).toBeNull();
    expect(screen.queryByText(/Everything in these sections, including collapsed folders/i)).toBeNull();

    fireEvent.click(screen.getByTestId('mass-backup-choose'));
    fireEvent.click(screen.getByTestId('mass-backup-replace'));
    fireEvent.click(screen.getByTestId('mass-backup-start'));

    expect(props.onChooseFolder).toHaveBeenCalledTimes(1);
    expect(props.onReplacePreviousChange).toHaveBeenCalledWith(true);
    expect(props.onStart).toHaveBeenCalledTimes(1);
  });

  it('keeps replacement off by default and explains the personal-file safety boundary', () => {
    renderDialog({ settings: { ...settings, replacePrevious: true } });

    const replacement = screen.getByTestId('mass-backup-replace');
    expect(replacement.getAttribute('data-state')).toBe('checked');
    expect(screen.getByText(/Personal files and unrelated ZIPs are never touched/i)).toBeTruthy();
  });

  it('renders inventory loading and animated zipping progress as controlled stages', () => {
    const onClose = vi.fn();
    const loading = render(<MassBackupDialog
      open
      inventory={null}
      settings={settings}
      stage="loading"
      onClose={onClose}
      onChooseFolder={vi.fn()}
      onReplacePreviousChange={vi.fn()}
      onStart={vi.fn()}
    />);
    expect(screen.getByTestId('mass-backup-inventory-loading')).toBeTruthy();
    expect(screen.getByText(/Scanning your library/i)).toBeTruthy();
    expect(screen.getByTestId('mass-backup-choose').disabled).toBe(true);
    expect(screen.getByTestId('mass-backup-start').disabled).toBe(true);
    loading.unmount();

    const progressView = render(<MassBackupDialog
      open
      inventory={inventory}
      settings={settings}
      stage="building"
      progress={{ kind: 'zipping', current: 2, total: 4, percent: 50, label: 'Zipping Notes' }}
      onClose={onClose}
      onChooseFolder={vi.fn()}
      onReplacePreviousChange={vi.fn()}
      onStart={vi.fn()}
      onRevealFolder={vi.fn()}
    />);

    const progress = screen.getByTestId('mass-backup-progress');
    expect(progress.dataset.stage).toBe('zipping');
    expect(within(progress).getByText('Zipping Notes')).toBeTruthy();
    expect(within(progress).getByRole('progressbar').getAttribute('aria-valuenow')).toBe('50');

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    progressView.unmount();

    render(<MassBackupDialog
      open
      inventory={inventory}
      settings={settings}
      stage="building"
      progress={{ kind: 'complete', label: 'ZIP archives ready' }}
      onClose={onClose}
      onStart={vi.fn()}
    />);
    expect(screen.getByTestId('mass-backup-progress').dataset.stage).toBe('zipping');
  });

  it('locks destination, replacement, and start controls while a setting is being saved', () => {
    const props = renderDialog({ settingsBusy: true });

    expect(screen.getByTestId('mass-backup-choose').disabled).toBe(true);
    expect(screen.getByTestId('mass-backup-replace').disabled).toBe(true);
    expect(screen.getByTestId('mass-backup-start').disabled).toBe(true);

    fireEvent.click(screen.getByTestId('mass-backup-choose'));
    fireEvent.click(screen.getByTestId('mass-backup-replace'));
    fireEvent.click(screen.getByTestId('mass-backup-start'));
    expect(props.onChooseFolder).not.toHaveBeenCalled();
    expect(props.onReplacePreviousChange).not.toHaveBeenCalled();
    expect(props.onStart).not.toHaveBeenCalled();
  });

  it('shows green per-archive confirmation, safe replacement count, and reveal action', () => {
    const props = renderDialog({
      stage: 'success',
      settings: { ...settings, replacePrevious: true },
      result: {
        files: [
          { category: 'web', fileName: 'BEX Knowledge Webs 2026-08-24.zip', itemCount: 4, bytes: 2400 },
          { category: 'note', fileName: 'BEX Notes 2026-08-24.zip', itemCount: 3, bytes: 1200 },
          { category: 'timeline', fileName: 'BEX Timelines 2026-08-24.zip', itemCount: 2, bytes: 800 },
        ],
        removed: 3,
        failures: [],
      },
    });

    expect(screen.getByTestId('mass-backup-success')).toBeTruthy();
    expect(screen.getAllByTestId('mass-backup-result-file')).toHaveLength(3);
    expect(screen.getByText('BEX Knowledge Webs 2026-08-24.zip')).toBeTruthy();
    expect(screen.getByText('BEX Notes 2026-08-24.zip')).toBeTruthy();
    expect(screen.getByText('BEX Timelines 2026-08-24.zip')).toBeTruthy();
    expect(screen.getByText(/Replaced 3 older BEX-created archives/i)).toBeTruthy();
    expect(screen.getByText(/Personal files were untouched/i)).toBeTruthy();

    fireEvent.click(screen.getByTestId('mass-backup-reveal'));
    fireEvent.click(screen.getByTestId('mass-backup-start'));
    expect(props.onRevealFolder).toHaveBeenCalledTimes(1);
    expect(props.onStart).toHaveBeenCalledTimes(1);
  });

  it('distinguishes saved cleanup warnings from recoverable hard errors', () => {
    const { unmount } = render(<MassBackupDialog
      open
      inventory={inventory}
      settings={settings}
      stage="partial"
      result={{
        files: [{ category: 'note', fileName: 'BEX Notes.zip', itemCount: 3 }],
        failures: [{ message: 'The new backup was saved, but one old archive could not be removed.' }],
      }}
      onClose={vi.fn()}
      onStart={vi.fn()}
      onRevealFolder={vi.fn()}
    />);

    expect(screen.getByTestId('mass-backup-partial')).toBeTruthy();
    expect(screen.getByText(/saved with a warning/i)).toBeTruthy();
    expect(screen.getByText(/one old archive could not be removed/i)).toBeTruthy();
    unmount();

    const onChooseFolder = vi.fn();
    const onRetry = vi.fn();
    render(<MassBackupDialog
      open
      inventory={null}
      settings={{ folderPath: '', replacePrevious: false }}
      stage="error"
      error="The destination folder is no longer available."
      onClose={vi.fn()}
      onChooseFolder={onChooseFolder}
      onRetry={onRetry}
      onStart={vi.fn()}
    />);
    expect(screen.getByTestId('mass-backup-error')).toBeTruthy();
    expect(screen.getByText('The destination folder is no longer available.')).toBeTruthy();
    fireEvent.click(screen.getByTestId('mass-backup-choose'));
    expect(onChooseFolder).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('mass-backup-start').disabled).toBe(false);
    expect(screen.getByTestId('mass-backup-start').textContent).toContain('Try again');
    fireEvent.click(screen.getByTestId('mass-backup-start'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('names a structurally invalid web and provides an actionable repair path', () => {
    const onResolveFailure = vi.fn();
    const failure = {
      kind: 'knowledge',
      itemId: 42,
      itemTitle: 'Gospel 4.2',
      message: 'This web has a card with a missing or duplicate ID and cannot be exported safely.',
    };
    renderDialog({
      stage: 'error',
      result: { files: [], failures: [failure] },
      error: 'Fix the item listed below, then try Mass Backup again. Nothing was written.',
      onResolveFailure,
    });

    expect(screen.getByText('Gospel 4.2')).toBeTruthy();
    expect(screen.getByText(/recreate the affected card, object, or connection/i)).toBeTruthy();
    fireEvent.click(screen.getByTestId('mass-backup-fix-item'));
    expect(onResolveFailure).toHaveBeenCalledWith(failure);
  });

  it('describes a partial backup as healthy archives saved with items needing attention', () => {
    renderDialog({
      stage: 'partial',
      result: {
        files: [{ category: 'note', fileName: 'BEX Notes.zip', itemCount: 3 }],
        failures: [{
          kind: 'knowledge',
          itemId: 42,
          itemTitle: 'Gospel 4.2',
          message: 'This web has a card with a missing or duplicate ID and cannot be exported safely.',
        }],
      },
    });

    expect(screen.getByTestId('mass-backup-partial')).toBeTruthy();
    expect(screen.getByText(/healthy archives shown below were saved/i)).toBeTruthy();
    expect(screen.getByText('Needs attention')).toBeTruthy();
    expect(screen.getByText('BEX Notes.zip')).toBeTruthy();
  });

  it('drops stale success actions and offers a new destination when the saved folder disappears', () => {
    const onChooseFolder = vi.fn();
    renderDialog({
      stage: 'partial',
      settings: { folderPath: '', replacePrevious: false },
      onChooseFolder,
      result: {
        files: [{ category: 'note', fileName: 'BEX Notes.zip', itemCount: 3 }],
        failures: [{ message: 'The saved backup folder is no longer available.' }],
      },
    });

    expect(screen.queryByTestId('mass-backup-reveal')).toBeNull();
    expect(screen.getByTestId('mass-backup-choose')).toBeTruthy();
    expect(screen.getByTestId('mass-backup-start').disabled).toBe(true);
    fireEvent.click(screen.getByTestId('mass-backup-choose'));
    expect(onChooseFolder).toHaveBeenCalledTimes(1);
  });
});
