import assert from 'node:assert/strict';
import test from 'node:test';
import {
  localEntities,
  replaceLocalKnowledgeWebGraph,
  runWithLocalBackupBarrier,
  waitForLocalEntityWritesToSettle,
} from '../src/lib/localEntities.js';

test('library export save barrier waits for writes and remembers failures until retry succeeds', async () => {
  const previousWindow = globalThis.window;
  let mode = 'slow-success';
  globalThis.window = {
    bexDesktop: {
      isDesktop: true,
      async updateLocalEntity(_entityType, entityId, patch) {
        if (mode === 'slow-success') {
          await new Promise((resolve) => setTimeout(resolve, 35));
          return { ok: true, record: { id: entityId, ...patch } };
        }
        if (mode === 'failure') return { ok: false, error: 'disk full' };
        return { ok: true, record: { id: entityId, ...patch } };
      },
      async restoreKnowledgeWebGraph() {
        await new Promise((resolve) => setTimeout(resolve, 35));
        return { ok: true, snapshot: { cards: [], connections: [], canvasObjects: [] } };
      },
      async saveLocalImage() {
        await new Promise((resolve) => setTimeout(resolve, 35));
        return { ok: true, media: { url: 'bex-media://saved-image' } };
      },
    },
  };

  try {
    const write = localEntities.MindNote.update(7, { title: 'Newest title' });
    let barrierFinished = false;
    const barrier = waitForLocalEntityWritesToSettle({ quietMs: 15, timeoutMs: 500 })
      .then(() => { barrierFinished = true; });
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(barrierFinished, false, 'barrier must not pass an in-flight save');
    await write;
    await barrier;
    assert.equal(barrierFinished, true);

    mode = 'failure';
    await assert.rejects(
      localEntities.MindNote.update(7, { content: '<p>Unsaved body</p>' }),
      /disk full/,
    );
    await assert.rejects(
      waitForLocalEntityWritesToSettle({ quietMs: 5, timeoutMs: 200 }),
      /could not save recent MindNote changes/i,
    );

    mode = 'success';
    await localEntities.MindNote.update(7, { title: 'A different saved field' });
    await assert.rejects(
      waitForLocalEntityWritesToSettle({ quietMs: 5, timeoutMs: 200 }),
      /could not save recent MindNote changes/i,
      'saving a title must not hide an earlier failed content save',
    );

    await localEntities.MindNote.update(7, { content: '<p>Recovered body</p>' });
    await waitForLocalEntityWritesToSettle({ quietMs: 5, timeoutMs: 200 });

    const restore = replaceLocalKnowledgeWebGraph(12, { cards: [] });
    const restoreBarrier = waitForLocalEntityWritesToSettle({ quietMs: 5, timeoutMs: 300 });
    let restoreBarrierFinished = false;
    void restoreBarrier.then(() => { restoreBarrierFinished = true; });
    await new Promise((resolve) => setTimeout(resolve, 15));
    assert.equal(restoreBarrierFinished, false, 'barrier must wait for an atomic graph restore');
    await restore;
    await restoreBarrier;

    const upload = runWithLocalBackupBarrier(async () => {
      await globalThis.window.bexDesktop.saveLocalImage();
      return { file_url: 'bex-media://saved-image' };
    });
    const uploadBarrier = waitForLocalEntityWritesToSettle({ quietMs: 5, timeoutMs: 300 });
    let uploadBarrierFinished = false;
    void uploadBarrier.then(() => { uploadBarrierFinished = true; });
    await new Promise((resolve) => setTimeout(resolve, 15));
    assert.equal(uploadBarrierFinished, false, 'barrier must wait for a protected image upload');
    await upload;
    await uploadBarrier;

    let delayedSaveStarted = false;
    let delayedSave = null;
    const uploadWithFollowUpDebounce = runWithLocalBackupBarrier(async () => {
      await new Promise((resolve) => setTimeout(resolve, 35));
      setTimeout(() => {
        delayedSaveStarted = true;
        delayedSave = localEntities.MindNote.update(7, { content: '<p>Image inserted</p>' });
      }, 15);
    });
    const followUpBarrier = waitForLocalEntityWritesToSettle({ quietMs: 25, timeoutMs: 400 });
    await uploadWithFollowUpDebounce;
    await followUpBarrier;
    assert.equal(delayedSaveStarted, true, 'the quiet window must restart when protected work settles');
    await delayedSave;

    mode = 'failure';
    await assert.rejects(
      localEntities.MindNote.update(8, { content: '<p>Will be deleted</p>' }),
      /disk full/,
    );
    mode = 'success';
    globalThis.window.bexDesktop.deleteLocalEntity = async () => ({
      ok: true,
      result: { deleted: true },
    });
    await localEntities.MindNote.delete(8);
    await waitForLocalEntityWritesToSettle({ quietMs: 5, timeoutMs: 200 });
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});
