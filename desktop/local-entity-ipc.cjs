'use strict';

const LOCAL_ENTITY_CHANNELS = Object.freeze({
  create: 'local-entity:create',
  delete: 'local-entity:delete',
  get: 'local-entity:get',
  importGraph: 'local-entity:import-knowledge-web-graph',
  list: 'local-entity:list',
  snapshot: 'local-entity:snapshot',
  reorder: 'local-entity:reorder',
  restoreGraph: 'local-entity:restore-knowledge-web-graph',
  update: 'local-entity:update',
});

const PUBLIC_ERROR_MESSAGES = Object.freeze({
  BEX_DATABASE_NOT_OPEN: 'Choose or reconnect the Berean Library before using local records.',
  BEX_ENTITY_INVALID: 'That local record is not valid.',
  BEX_ENTITY_NOT_FOUND: 'That local record no longer exists.',
  BEX_ENTITY_TOO_LARGE: 'That local record is too large to save safely.',
  BEX_ENTITY_SNAPSHOT_TOO_LARGE: 'The complete library is too large to export safely. Nothing was truncated or written.',
  BEX_ENTITY_UNSUPPORTED: 'That type of local record is not available yet.',
  BEX_PRIVACY_LOCKED: 'Unlock the Berean Library before using private records.',
  BEX_PRIVACY_NOT_OPEN: 'The encrypted Berean Library vault is unavailable.',
  BEX_UNTRUSTED_SENDER: 'BEX blocked a local-data request from an untrusted page.',
});

function codedError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function assertTrustedSender(event, trustedOrigin) {
  const senderUrl = event?.senderFrame?.url
    || (event?.sender && typeof event.sender.getURL === 'function' ? event.sender.getURL() : '');
  let senderOrigin = null;
  try {
    senderOrigin = new URL(senderUrl).origin;
  } catch {
    // A malformed sender URL is never trusted.
  }
  if (senderOrigin !== trustedOrigin) {
    throw codedError('BEX_UNTRUSTED_SENDER', 'Blocked a local-data request from an untrusted page.');
  }
}

function errorResponse(error, fallbackMessage) {
  const publicMessage = error && typeof error.code === 'string'
    ? PUBLIC_ERROR_MESSAGES[error.code]
    : null;
  return {
    ok: false,
    code: typeof error?.code === 'string' ? error.code : null,
    error: publicMessage || fallbackMessage,
  };
}

function registerLocalEntityHandlers(options) {
  const {
    appUrl,
    createLocalEntity,
    deleteLocalEntity,
    getLocalEntity,
    ipcMain,
    importKnowledgeWebGraph,
    listLocalEntities,
    readLocalEntitySnapshot,
    reorderLocalEntities,
    restoreKnowledgeWebGraph,
    updateLocalEntity,
  } = options || {};
  if (typeof appUrl !== 'string' || !ipcMain) {
    throw new TypeError('The local entity bridge requires the BEX application URL and Electron IPC.');
  }
  const actions = {
    createLocalEntity,
    deleteLocalEntity,
    getLocalEntity,
    importKnowledgeWebGraph,
    listLocalEntities,
    reorderLocalEntities,
    restoreKnowledgeWebGraph,
    updateLocalEntity,
  };
  for (const [name, action] of Object.entries(actions)) {
    if (typeof action !== 'function') {
      throw new TypeError(`The local entity bridge is missing ${name}.`);
    }
  }

  const trustedOrigin = new URL(appUrl).origin;
  for (const channel of Object.values(LOCAL_ENTITY_CHANNELS)) ipcMain.removeHandler(channel);

  ipcMain.handle(LOCAL_ENTITY_CHANNELS.snapshot, async (event, entityTypes) => {
    try {
      assertTrustedSender(event, trustedOrigin);
      if (typeof readLocalEntitySnapshot !== 'function') throw new Error('Snapshot unavailable');
      return { ok: true, snapshot: await readLocalEntitySnapshot(entityTypes) };
    } catch (error) { return errorResponse(error, 'BEX could not read a complete library snapshot.'); }
  });

  ipcMain.handle(LOCAL_ENTITY_CHANNELS.list, async (event, entityType, query) => {
    try {
      assertTrustedSender(event, trustedOrigin);
      return { ok: true, records: await listLocalEntities(entityType, query) };
    } catch (error) {
      return errorResponse(error, 'BEX could not read the local records.');
    }
  });

  ipcMain.handle(LOCAL_ENTITY_CHANNELS.get, async (event, entityType, entityId) => {
    try {
      assertTrustedSender(event, trustedOrigin);
      return { ok: true, record: await getLocalEntity(entityType, entityId) };
    } catch (error) {
      return errorResponse(error, 'BEX could not read the local record.');
    }
  });

  ipcMain.handle(LOCAL_ENTITY_CHANNELS.importGraph, async (event, webId, importValue, options) => {
    try {
      assertTrustedSender(event, trustedOrigin);
      return { ok: true, result: await importKnowledgeWebGraph(webId, importValue, options) };
    } catch (error) {
      return errorResponse(error, 'BEX could not import the Knowledge Web.');
    }
  });

  ipcMain.handle(LOCAL_ENTITY_CHANNELS.create, async (event, entityType, value) => {
    try {
      assertTrustedSender(event, trustedOrigin);
      return { ok: true, record: await createLocalEntity(entityType, value) };
    } catch (error) {
      return errorResponse(error, 'BEX could not create the local record.');
    }
  });

  ipcMain.handle(LOCAL_ENTITY_CHANNELS.update, async (event, entityType, entityId, patch) => {
    try {
      assertTrustedSender(event, trustedOrigin);
      return { ok: true, record: await updateLocalEntity(entityType, entityId, patch) };
    } catch (error) {
      return errorResponse(error, 'BEX could not update the local record.');
    }
  });

  ipcMain.handle(LOCAL_ENTITY_CHANNELS.reorder, async (event, entityType, entityIds, containerId) => {
    try {
      assertTrustedSender(event, trustedOrigin);
      return {
        ok: true,
        records: await reorderLocalEntities(entityType, entityIds, containerId),
      };
    } catch (error) {
      return errorResponse(error, 'BEX could not save the local record order.');
    }
  });

  ipcMain.handle(LOCAL_ENTITY_CHANNELS.restoreGraph, async (event, webId, snapshot) => {
    try {
      assertTrustedSender(event, trustedOrigin);
      return { ok: true, snapshot: await restoreKnowledgeWebGraph(webId, snapshot) };
    } catch (error) {
      return errorResponse(error, 'BEX could not restore the Knowledge Web snapshot.');
    }
  });

  ipcMain.handle(LOCAL_ENTITY_CHANNELS.delete, async (event, entityType, entityId) => {
    try {
      assertTrustedSender(event, trustedOrigin);
      return { ok: true, result: await deleteLocalEntity(entityType, entityId) };
    } catch (error) {
      return errorResponse(error, 'BEX could not delete the local record.');
    }
  });
}

module.exports = {
  LOCAL_ENTITY_CHANNELS,
  registerLocalEntityHandlers,
};
