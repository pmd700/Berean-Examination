'use strict';

const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');
const { activateDatabase, readActivationState } = require('./activation-store.cjs');
const { CourseStore } = require('./course-store.cjs');
const { installLocalCoursePackage } = require('./course-package.cjs');
const {
  readLocalOwnerProfile,
  updateLocalOwnerPreferences,
} = require('./local-owner-store.cjs');
const { LocalEntityStore } = require('./local-entity-store.cjs');
const {
  deleteEncryptedMedia,
  readEncryptedMedia,
  saveEncryptedImage,
} = require('./local-media.cjs');
const {
  createEncryptedLocalBackup,
  readDatabaseSummary,
  resolveBackupFolder,
} = require('./local-backup.cjs');
const {
  assertRestoredSummary,
  completeLocalRestore,
  inspectLocalRestoreBackup,
  installLocalRestore,
  recoverInterruptedRestore,
  rollbackLocalRestore,
} = require('./local-restore.cjs');
const { PRIVACY_SCHEMA_SQL, PrivacyVault } = require('./privacy-vault.cjs');

const DATABASE_FILE_NAME = 'berean.db';
const MIGRATIONS = Object.freeze([
  Object.freeze({
    version: 1,
    name: 'database_foundation',
    sql: `
      CREATE TABLE app_metadata (
        key TEXT PRIMARY KEY NOT NULL,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
    `,
  }),
  Object.freeze({
    version: 2,
    name: 'local_activation_owner',
    sql: `
      CREATE TABLE activation_record (
        singleton_id INTEGER PRIMARY KEY NOT NULL CHECK (singleton_id = 1),
        verification_version INTEGER NOT NULL CHECK (verification_version > 0),
        request_code TEXT NOT NULL CHECK (length(request_code) > 0),
        machine_binding_hash TEXT NOT NULL CHECK (length(machine_binding_hash) > 0),
        signed_activation TEXT NOT NULL CHECK (length(signed_activation) > 0),
        signing_key_id TEXT NOT NULL CHECK (length(signing_key_id) > 0),
        issued_at TEXT NOT NULL CHECK (length(issued_at) > 0),
        activated_at TEXT NOT NULL CHECK (length(activated_at) > 0)
      ) STRICT;

      CREATE TABLE local_owner (
        singleton_id INTEGER PRIMARY KEY NOT NULL CHECK (singleton_id = 1),
        owner_id TEXT NOT NULL UNIQUE CHECK (length(owner_id) > 0),
        display_name TEXT,
        avatar_path TEXT,
        created_at TEXT NOT NULL CHECK (length(created_at) > 0),
        updated_at TEXT NOT NULL CHECK (length(updated_at) > 0)
      ) STRICT;
    `,
  }),
  Object.freeze({
    version: 3,
    name: 'local_owner_preferences',
    sql: `
      ALTER TABLE local_owner
      ADD COLUMN preferences_json TEXT NOT NULL DEFAULT '{}'
        CHECK (length(preferences_json) BETWEEN 2 AND 65536);
    `,
  }),
  Object.freeze({
    version: 4,
    name: 'encrypted_private_storage',
    sql: PRIVACY_SCHEMA_SQL,
  }),
  Object.freeze({
    version: 5,
    name: 'encrypted_local_entity_bridge',
    sql: `
      CREATE TABLE local_entity_sequences (
        entity_type TEXT PRIMARY KEY NOT NULL CHECK (length(entity_type) BETWEEN 1 AND 100),
        last_id INTEGER NOT NULL CHECK (last_id > 0)
      ) STRICT;

      CREATE TABLE local_knowledge_webs (
        id INTEGER PRIMARY KEY NOT NULL CHECK (id > 0),
        encrypted_payload BLOB NOT NULL CHECK (length(encrypted_payload) > 29),
        created_at TEXT NOT NULL CHECK (length(created_at) > 0),
        updated_at TEXT NOT NULL CHECK (length(updated_at) > 0)
      ) STRICT;

      CREATE INDEX local_knowledge_webs_updated_at
      ON local_knowledge_webs(updated_at DESC);
    `,
  }),
  Object.freeze({
    version: 6,
    name: 'encrypted_knowledge_web_graph',
    sql: `
      CREATE TABLE local_web_cards (
        id INTEGER PRIMARY KEY NOT NULL CHECK (id > 0),
        web_id INTEGER NOT NULL CHECK (web_id > 0)
          REFERENCES local_knowledge_webs(id) ON DELETE CASCADE,
        encrypted_payload BLOB NOT NULL CHECK (length(encrypted_payload) > 29),
        created_at TEXT NOT NULL CHECK (length(created_at) > 0),
        updated_at TEXT NOT NULL CHECK (length(updated_at) > 0)
      ) STRICT;

      CREATE INDEX local_web_cards_web_updated_at
      ON local_web_cards(web_id, updated_at DESC);

      CREATE TABLE local_web_connections (
        id INTEGER PRIMARY KEY NOT NULL CHECK (id > 0),
        web_id INTEGER NOT NULL CHECK (web_id > 0)
          REFERENCES local_knowledge_webs(id) ON DELETE CASCADE,
        encrypted_payload BLOB NOT NULL CHECK (length(encrypted_payload) > 29),
        created_at TEXT NOT NULL CHECK (length(created_at) > 0),
        updated_at TEXT NOT NULL CHECK (length(updated_at) > 0)
      ) STRICT;

      CREATE INDEX local_web_connections_web_updated_at
      ON local_web_connections(web_id, updated_at DESC);

      CREATE TABLE local_canvas_objects (
        id INTEGER PRIMARY KEY NOT NULL CHECK (id > 0),
        web_id INTEGER NOT NULL CHECK (web_id > 0)
          REFERENCES local_knowledge_webs(id) ON DELETE CASCADE,
        encrypted_payload BLOB NOT NULL CHECK (length(encrypted_payload) > 29),
        created_at TEXT NOT NULL CHECK (length(created_at) > 0),
        updated_at TEXT NOT NULL CHECK (length(updated_at) > 0)
      ) STRICT;

      CREATE INDEX local_canvas_objects_web_updated_at
      ON local_canvas_objects(web_id, updated_at DESC);
    `,
  }),
  Object.freeze({
    version: 7,
    name: 'encrypted_knowledge_web_folders',
    sql: `
      CREATE TABLE local_web_folders (
        id INTEGER PRIMARY KEY NOT NULL CHECK (id > 0),
        encrypted_payload BLOB NOT NULL CHECK (length(encrypted_payload) > 29),
        created_at TEXT NOT NULL CHECK (length(created_at) > 0),
        updated_at TEXT NOT NULL CHECK (length(updated_at) > 0)
      ) STRICT;

      CREATE INDEX local_web_folders_updated_at
      ON local_web_folders(updated_at DESC);
    `,
  }),
  Object.freeze({
    version: 8,
    name: 'encrypted_mind_notes_and_links',
    sql: `
      CREATE TABLE local_mind_notes (
        id INTEGER PRIMARY KEY NOT NULL CHECK (id > 0),
        encrypted_payload BLOB NOT NULL CHECK (length(encrypted_payload) > 29),
        created_at TEXT NOT NULL CHECK (length(created_at) > 0),
        updated_at TEXT NOT NULL CHECK (length(updated_at) > 0)
      ) STRICT;

      CREATE INDEX local_mind_notes_updated_at
      ON local_mind_notes(updated_at DESC);

      CREATE TABLE local_mind_links (
        id INTEGER PRIMARY KEY NOT NULL CHECK (id > 0),
        encrypted_payload BLOB NOT NULL CHECK (length(encrypted_payload) > 29),
        created_at TEXT NOT NULL CHECK (length(created_at) > 0),
        updated_at TEXT NOT NULL CHECK (length(updated_at) > 0)
      ) STRICT;

      CREATE INDEX local_mind_links_updated_at
      ON local_mind_links(updated_at DESC);
    `,
  }),
  Object.freeze({
    version: 9,
    name: 'encrypted_knowledge_web_versions',
    sql: `
      CREATE TABLE local_web_versions (
        id INTEGER PRIMARY KEY NOT NULL CHECK (id > 0),
        web_id INTEGER NOT NULL CHECK (web_id > 0)
          REFERENCES local_knowledge_webs(id) ON DELETE CASCADE,
        encrypted_payload BLOB NOT NULL CHECK (length(encrypted_payload) > 29),
        created_at TEXT NOT NULL CHECK (length(created_at) > 0),
        updated_at TEXT NOT NULL CHECK (length(updated_at) > 0)
      ) STRICT;

      CREATE INDEX local_web_versions_web_created_at
      ON local_web_versions(web_id, created_at DESC);
    `,
  }),
  Object.freeze({
    version: 10,
    name: 'encrypted_second_brain_sources',
    sql: `
      CREATE TABLE local_brain_sources (
        id INTEGER PRIMARY KEY NOT NULL CHECK (id > 0),
        encrypted_payload BLOB NOT NULL CHECK (length(encrypted_payload) > 29),
        created_at TEXT NOT NULL CHECK (length(created_at) > 0),
        updated_at TEXT NOT NULL CHECK (length(updated_at) > 0)
      ) STRICT;

      CREATE INDEX local_brain_sources_updated_at
      ON local_brain_sources(updated_at DESC);
    `,
  }),
  Object.freeze({
    version: 11,
    name: 'encrypted_bible_study_records',
    sql: `
      CREATE TABLE local_study_chapters (
        id INTEGER PRIMARY KEY NOT NULL CHECK (id > 0),
        encrypted_payload BLOB NOT NULL CHECK (length(encrypted_payload) > 29),
        created_at TEXT NOT NULL CHECK (length(created_at) > 0),
        updated_at TEXT NOT NULL CHECK (length(updated_at) > 0)
      ) STRICT;

      CREATE INDEX local_study_chapters_updated_at
      ON local_study_chapters(updated_at DESC);

      CREATE TABLE local_annotations (
        id INTEGER PRIMARY KEY NOT NULL CHECK (id > 0),
        encrypted_payload BLOB NOT NULL CHECK (length(encrypted_payload) > 29),
        created_at TEXT NOT NULL CHECK (length(created_at) > 0),
        updated_at TEXT NOT NULL CHECK (length(updated_at) > 0)
      ) STRICT;

      CREATE INDEX local_annotations_updated_at
      ON local_annotations(updated_at DESC);

      CREATE TABLE local_text_highlights (
        id INTEGER PRIMARY KEY NOT NULL CHECK (id > 0),
        encrypted_payload BLOB NOT NULL CHECK (length(encrypted_payload) > 29),
        created_at TEXT NOT NULL CHECK (length(created_at) > 0),
        updated_at TEXT NOT NULL CHECK (length(updated_at) > 0)
      ) STRICT;

      CREATE INDEX local_text_highlights_updated_at
      ON local_text_highlights(updated_at DESC);

      CREATE TABLE local_keywords (
        id INTEGER PRIMARY KEY NOT NULL CHECK (id > 0),
        encrypted_payload BLOB NOT NULL CHECK (length(encrypted_payload) > 29),
        created_at TEXT NOT NULL CHECK (length(created_at) > 0),
        updated_at TEXT NOT NULL CHECK (length(updated_at) > 0)
      ) STRICT;

      CREATE INDEX local_keywords_updated_at
      ON local_keywords(updated_at DESC);

      CREATE TABLE local_drawings (
        id INTEGER PRIMARY KEY NOT NULL CHECK (id > 0),
        encrypted_payload BLOB NOT NULL CHECK (length(encrypted_payload) > 29),
        created_at TEXT NOT NULL CHECK (length(created_at) > 0),
        updated_at TEXT NOT NULL CHECK (length(updated_at) > 0)
      ) STRICT;

      CREATE INDEX local_drawings_updated_at
      ON local_drawings(updated_at DESC);

      CREATE TABLE local_daily_activities (
        id INTEGER PRIMARY KEY NOT NULL CHECK (id > 0),
        encrypted_payload BLOB NOT NULL CHECK (length(encrypted_payload) > 29),
        created_at TEXT NOT NULL CHECK (length(created_at) > 0),
        updated_at TEXT NOT NULL CHECK (length(updated_at) > 0)
      ) STRICT;

      CREATE INDEX local_daily_activities_updated_at
      ON local_daily_activities(updated_at DESC);
    `,
  }),
  Object.freeze({
    version: 12,
    name: 'encrypted_asset_library',
    sql: `
      CREATE TABLE local_assets (
        id INTEGER PRIMARY KEY NOT NULL CHECK (id > 0),
        encrypted_payload BLOB NOT NULL CHECK (length(encrypted_payload) > 29),
        created_at TEXT NOT NULL CHECK (length(created_at) > 0),
        updated_at TEXT NOT NULL CHECK (length(updated_at) > 0)
      ) STRICT;

      CREATE INDEX local_assets_updated_at
      ON local_assets(updated_at DESC);
    `,
  }),
  Object.freeze({
    version: 13,
    name: 'encrypted_chapter_art_catalog',
    sql: `
      CREATE TABLE local_chapter_art_catalogs (
        id INTEGER PRIMARY KEY NOT NULL CHECK (id > 0),
        encrypted_payload BLOB NOT NULL CHECK (length(encrypted_payload) > 29),
        created_at TEXT NOT NULL CHECK (length(created_at) > 0),
        updated_at TEXT NOT NULL CHECK (length(updated_at) > 0)
      ) STRICT;

      CREATE INDEX local_chapter_art_catalogs_updated_at
      ON local_chapter_art_catalogs(updated_at DESC);
    `,
  }),
  Object.freeze({
    version: 14,
    name: 'offline_course_library',
    sql: `
      CREATE TABLE course_versions (
        course_id TEXT NOT NULL CHECK (length(course_id) BETWEEN 2 AND 80),
        version TEXT NOT NULL CHECK (length(version) BETWEEN 1 AND 80),
        manifest_version INTEGER NOT NULL CHECK (manifest_version = 1),
        manifest_json TEXT NOT NULL CHECK (length(manifest_json) BETWEEN 2 AND 1048576),
        manifest_signature TEXT,
        release_notes TEXT NOT NULL DEFAULT '' CHECK (length(release_notes) <= 10000),
        total_bytes INTEGER NOT NULL DEFAULT 0 CHECK (total_bytes >= 0),
        published_at TEXT NOT NULL CHECK (length(published_at) > 0),
        created_at TEXT NOT NULL CHECK (length(created_at) > 0),
        PRIMARY KEY (course_id, version)
      ) STRICT;

      CREATE TABLE course_catalog (
        course_id TEXT PRIMARY KEY NOT NULL CHECK (length(course_id) BETWEEN 2 AND 80),
        active_version TEXT NOT NULL CHECK (length(active_version) BETWEEN 1 AND 80),
        title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 300),
        description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 20000),
        author TEXT NOT NULL CHECK (length(author) BETWEEN 1 AND 300),
        artwork_url TEXT NOT NULL DEFAULT '' CHECK (length(artwork_url) <= 500),
        accent TEXT NOT NULL DEFAULT '#8B6BC2' CHECK (length(accent) = 7),
        install_state TEXT NOT NULL CHECK (
          install_state IN ('available', 'downloading', 'installed', 'update_available')
        ),
        download_bytes INTEGER NOT NULL DEFAULT 0 CHECK (download_bytes >= 0),
        downloaded_bytes INTEGER NOT NULL DEFAULT 0 CHECK (
          downloaded_bytes >= 0 AND downloaded_bytes <= download_bytes
        ),
        position INTEGER NOT NULL DEFAULT 0 CHECK (position >= 0),
        created_at TEXT NOT NULL CHECK (length(created_at) > 0),
        updated_at TEXT NOT NULL CHECK (length(updated_at) > 0)
      ) STRICT;

      CREATE INDEX course_catalog_position
      ON course_catalog(position ASC, title COLLATE NOCASE ASC);

      CREATE TABLE course_modules (
        course_id TEXT NOT NULL,
        version TEXT NOT NULL,
        module_id TEXT NOT NULL CHECK (length(module_id) BETWEEN 2 AND 80),
        title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 300),
        description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 10000),
        position INTEGER NOT NULL CHECK (position >= 0),
        PRIMARY KEY (course_id, version, module_id),
        UNIQUE (course_id, version, position),
        FOREIGN KEY (course_id, version)
          REFERENCES course_versions(course_id, version) ON DELETE CASCADE
      ) STRICT;

      CREATE TABLE course_assets (
        asset_id TEXT NOT NULL CHECK (length(asset_id) BETWEEN 2 AND 80),
        course_id TEXT NOT NULL,
        version TEXT NOT NULL,
        role TEXT NOT NULL CHECK (length(role) BETWEEN 1 AND 40),
        sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
        byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
        mime_type TEXT NOT NULL CHECK (length(mime_type) BETWEEN 3 AND 120),
        relative_path TEXT NOT NULL CHECK (length(relative_path) BETWEEN 1 AND 500),
        PRIMARY KEY (course_id, version, asset_id),
        FOREIGN KEY (course_id, version)
          REFERENCES course_versions(course_id, version) ON DELETE CASCADE
      ) STRICT;

      CREATE INDEX course_assets_fingerprint
      ON course_assets(sha256);

      CREATE TABLE course_lessons (
        course_id TEXT NOT NULL,
        version TEXT NOT NULL,
        lesson_id TEXT NOT NULL CHECK (length(lesson_id) BETWEEN 2 AND 80),
        module_id TEXT NOT NULL,
        module_position INTEGER NOT NULL CHECK (module_position >= 0),
        title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 300),
        description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 20000),
        duration_seconds INTEGER NOT NULL DEFAULT 0 CHECK (duration_seconds >= 0),
        media_asset_id TEXT,
        poster_asset_id TEXT,
        position INTEGER NOT NULL CHECK (position >= 0),
        PRIMARY KEY (course_id, version, lesson_id),
        UNIQUE (course_id, version, module_id, position),
        FOREIGN KEY (course_id, version, module_id)
          REFERENCES course_modules(course_id, version, module_id) ON DELETE CASCADE
      ) STRICT;

      CREATE INDEX course_lessons_order
      ON course_lessons(course_id, version, module_position ASC, position ASC);

      CREATE TABLE course_installations (
        course_id TEXT NOT NULL,
        version TEXT NOT NULL,
        state TEXT NOT NULL CHECK (
          state IN ('available', 'downloading', 'installed', 'update_available')
        ),
        installed_at TEXT,
        last_error TEXT CHECK (last_error IS NULL OR length(last_error) <= 1000),
        updated_at TEXT NOT NULL CHECK (length(updated_at) > 0),
        PRIMARY KEY (course_id, version),
        FOREIGN KEY (course_id, version)
          REFERENCES course_versions(course_id, version) ON DELETE CASCADE
      ) STRICT;

      CREATE TABLE course_progress_index (
        course_id TEXT NOT NULL,
        lesson_id TEXT NOT NULL,
        private_record_id TEXT NOT NULL UNIQUE,
        updated_at TEXT NOT NULL CHECK (length(updated_at) > 0),
        PRIMARY KEY (course_id, lesson_id),
        FOREIGN KEY (course_id)
          REFERENCES course_catalog(course_id) ON DELETE CASCADE,
        FOREIGN KEY (private_record_id)
          REFERENCES private_records(record_id) ON DELETE CASCADE
      ) STRICT;
    `,
  }),
  Object.freeze({
    version: 15,
    name: 'encrypted_timegraphs',
    sql: `
      CREATE TABLE local_timegraphs (
        id INTEGER PRIMARY KEY NOT NULL CHECK (id > 0),
        encrypted_payload BLOB NOT NULL CHECK (length(encrypted_payload) > 29),
        created_at TEXT NOT NULL CHECK (length(created_at) > 0),
        updated_at TEXT NOT NULL CHECK (length(updated_at) > 0)
      ) STRICT;

      CREATE INDEX local_timegraphs_updated_at
      ON local_timegraphs(updated_at DESC);
    `,
  }),
]);

let activeDatabase = null;
let activeDatabasePath = null;
let activePrivacyVault = null;
let activeEntityStore = null;
let activeCourseStore = null;

function currentSchemaVersion() {
  return MIGRATIONS.length ? MIGRATIONS[MIGRATIONS.length - 1].version : 0;
}

function createMigrationTable(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    ) STRICT;
  `);
}

function applyMigrations(database) {
  createMigrationTable(database);

  const appliedRows = database
    .prepare('SELECT version, name FROM schema_migrations ORDER BY version')
    .all();
  const knownMigrations = new Map(MIGRATIONS.map((migration) => [migration.version, migration]));

  for (const row of appliedRows) {
    const knownMigration = knownMigrations.get(Number(row.version));
    if (!knownMigration) {
      throw new Error(
        'This Berean Library was opened by a newer BEX database version. Update BEX before continuing.',
      );
    }
    if (knownMigration.name !== row.name) {
      throw new Error('The local database migration history does not match this BEX version.');
    }
  }

  const appliedVersions = new Set(appliedRows.map((row) => Number(row.version)));
  const recordMigration = database.prepare(
    'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)',
  );

  for (const migration of MIGRATIONS) {
    if (appliedVersions.has(migration.version)) continue;

    database.exec('BEGIN IMMEDIATE');
    try {
      database.exec(migration.sql);
      recordMigration.run(migration.version, migration.name, new Date().toISOString());
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  }

  return currentSchemaVersion();
}

function requireActiveDatabase() {
  if (!activeDatabase) {
    const error = new Error('The Berean Library database is not open.');
    error.code = 'BEX_DATABASE_NOT_OPEN';
    throw error;
  }
  return activeDatabase;
}

function requirePrivacyVault() {
  if (!activePrivacyVault) {
    const error = new Error('The encrypted Berean Library vault is not open.');
    error.code = 'BEX_PRIVACY_NOT_OPEN';
    throw error;
  }
  return activePrivacyVault;
}

function requireEntityStore() {
  if (!activeEntityStore) {
    const error = new Error('The local entity store is not open.');
    error.code = 'BEX_DATABASE_NOT_OPEN';
    throw error;
  }
  return activeEntityStore;
}

function requireCourseStore() {
  if (!activeCourseStore) {
    const error = new Error('The local Course store is not open.');
    error.code = 'BEX_DATABASE_NOT_OPEN';
    throw error;
  }
  return activeCourseStore;
}

function activeLibraryPath() {
  if (!activeDatabasePath) {
    const error = new Error('The Berean Library database is not open.');
    error.code = 'BEX_DATABASE_NOT_OPEN';
    throw error;
  }
  return path.dirname(path.dirname(activeDatabasePath));
}

function getActivationState() {
  return readActivationState(requireActiveDatabase());
}

function activateInstallation(activationCode) {
  return activateDatabase(requireActiveDatabase(), activationCode);
}

function getLocalOwner() {
  return readLocalOwnerProfile(requireActiveDatabase());
}

function updateLocalOwner(patch) {
  return updateLocalOwnerPreferences(requireActiveDatabase(), patch);
}

function getPrivacyStatus() {
  return requirePrivacyVault().getStatus();
}

function lockPrivacyVault() {
  const vault = requirePrivacyVault();
  vault.lock();
  return vault.getStatus();
}

function unlockPrivacyAutomatically() {
  const vault = requirePrivacyVault();
  if (vault.getProtectionMode() !== 'automatic') return vault.getStatus();
  if (vault.isLocked()) vault.unlockAutomatically();
  return vault.getStatus();
}

function enablePrivacyPin(pin) {
  const vault = requirePrivacyVault();
  const recoveryCode = vault.enablePin(pin);
  return { recoveryCode, status: vault.getStatus() };
}

function unlockPrivacyWithPin(pin) {
  const vault = requirePrivacyVault();
  vault.unlockWithPin(pin);
  return vault.getStatus();
}

function unlockPrivacyWithRecoveryCode(recoveryCode) {
  const vault = requirePrivacyVault();
  vault.unlockWithRecoveryCode(recoveryCode);
  return vault.getStatus();
}

function changePrivacyPin(pin) {
  const vault = requirePrivacyVault();
  vault.changePin(pin);
  return vault.getStatus();
}

function replacePrivacyRecoveryCode() {
  const vault = requirePrivacyVault();
  const recoveryCode = vault.replaceRecoveryCode();
  return { recoveryCode, status: vault.getStatus() };
}

function disablePrivacyPin() {
  const vault = requirePrivacyVault();
  vault.disablePin();
  return vault.getStatus();
}

function savePrivateRecord(recordId, recordType, value) {
  requirePrivacyVault().saveRecord(recordId, recordType, value);
}

function readPrivateRecord(recordId) {
  return requirePrivacyVault().readRecord(recordId);
}

async function createLocalBackup() {
  const result = await createEncryptedLocalBackup({
    database: requireActiveDatabase(),
    libraryPath: activeLibraryPath(),
    privacyVault: requirePrivacyVault(),
  });
  const { path: _privatePath, ...publicResult } = result;
  return publicResult;
}

function getLocalDatabaseSummary() {
  return readDatabaseSummary(requireActiveDatabase());
}

function getLocalBackupFolder() {
  return resolveBackupFolder(activeLibraryPath());
}

function inspectLocalBackupForRestore(backupPath) {
  const result = inspectLocalRestoreBackup({
    backupPath,
    libraryPath: activeLibraryPath(),
    maxSchemaVersion: currentSchemaVersion(),
  });
  const { path: _privatePath, ...publicResult } = result;
  return publicResult;
}

async function restoreLocalBackup(backupPath, { privacyProtector } = {}) {
  const libraryPath = activeLibraryPath();
  const databasePath = activeDatabasePath;
  const inspected = inspectLocalRestoreBackup({
    backupPath,
    libraryPath,
    maxSchemaVersion: currentSchemaVersion(),
  });
  const emergencyBackup = await createEncryptedLocalBackup({
    database: requireActiveDatabase(),
    libraryPath,
    privacyVault: requirePrivacyVault(),
  });

  closeDatabase();
  try {
    installLocalRestore({ backupPath: inspected.path, databasePath });
    const reopened = initializeDatabase(libraryPath, {
      privacyProtector,
      skipRestoreRecovery: true,
    });
    const restoredSummary = getLocalDatabaseSummary();
    assertRestoredSummary(inspected, restoredSummary);
    completeLocalRestore(databasePath);
    return {
      emergencyBackupFileName: emergencyBackup.fileName,
      fileName: inspected.fileName,
      privacy: reopened.privacy,
      recordCount: restoredSummary.recordCount,
      schemaVersion: restoredSummary.schemaVersion,
    };
  } catch (restoreError) {
    closeDatabase();
    try {
      rollbackLocalRestore(databasePath);
      initializeDatabase(libraryPath, { privacyProtector });
    } catch (rollbackError) {
      const error = new Error(
        'BEX could not finish the restore or automatically reopen the original database.',
      );
      error.code = 'BEX_RESTORE_ROLLBACK_FAILED';
      error.restoreCause = restoreError?.code || null;
      error.rollbackCause = rollbackError?.code || null;
      throw error;
    }
    const error = new Error(
      'The selected backup could not be restored. BEX put the original database back.',
    );
    error.code = 'BEX_RESTORE_FAILED';
    error.restoreCause = restoreError?.code || null;
    error.rolledBack = true;
    throw error;
  }
}

function createLocalEntity(entityType, value) {
  return requireEntityStore().create(entityType, value);
}

function getLocalEntity(entityType, entityId) {
  return requireEntityStore().get(entityType, entityId);
}

function listLocalEntities(entityType, query) {
  return requireEntityStore().list(entityType, query);
}

function listCourseLibrary() {
  return requireCourseStore().listLibrary();
}

function installCourseVersion(course) {
  return requireCourseStore().installCourseVersion(course);
}

function getActiveLibraryPath() {
  return activeLibraryPath();
}

async function installCoursePackage(packagePath, options = {}) {
  return installLocalCoursePackage({
    ...options,
    installCourseVersion: (course) => requireCourseStore().installCourseVersion(course),
    libraryPath: activeLibraryPath(),
    packagePath,
  });
}

function saveCourseProgress(courseId, lessonId, progress) {
  return requireCourseStore().saveProgress(courseId, lessonId, progress);
}

function resolveCourseAsset(identity) {
  const asset = requireCourseStore().resolveAsset(identity);
  const coursesRoot = path.join(activeLibraryPath(), 'Courses');
  const assetPath = path.resolve(coursesRoot, asset.relativePath);
  if (assetPath === coursesRoot || !assetPath.startsWith(coursesRoot + path.sep)) {
    const error = new Error('The installed Course file path is unsafe.');
    error.code = 'BEX_COURSE_ASSET_INVALID';
    throw error;
  }
  const stats = fs.lstatSync(assetPath);
  if (!stats.isFile() || stats.isSymbolicLink() || stats.size !== asset.byteSize) {
    const error = new Error('The installed Course file is missing or damaged.');
    error.code = 'BEX_COURSE_ASSET_INVALID';
    throw error;
  }
  const realCoursesRoot = fs.realpathSync(coursesRoot);
  const realAssetPath = fs.realpathSync(assetPath);
  if (!realAssetPath.startsWith(realCoursesRoot + path.sep)) {
    const error = new Error('The installed Course file path leaves the Berean Library.');
    error.code = 'BEX_COURSE_ASSET_INVALID';
    throw error;
  }
  return { ...asset, path: realAssetPath };
}

function importKnowledgeWebGraph(webId, importValue, options) {
  return requireEntityStore().importKnowledgeWebGraph(webId, importValue, options);
}

function reorderLocalEntities(entityType, entityIds, containerId) {
  return requireEntityStore().reorder(entityType, entityIds, containerId);
}

function restoreKnowledgeWebGraph(webId, snapshot) {
  return requireEntityStore().restoreKnowledgeWebGraph(webId, snapshot);
}

function saveLocalImage(payload) {
  return saveEncryptedImage({
    libraryPath: activeLibraryPath(),
    payload,
    privacyVault: requirePrivacyVault(),
  });
}

function readLocalMedia(mediaUrl) {
  return readEncryptedMedia({
    libraryPath: activeLibraryPath(),
    mediaUrl,
    privacyVault: requirePrivacyVault(),
  });
}

function deleteLocalImage(mediaUrl) {
  return deleteEncryptedMedia({
    libraryPath: activeLibraryPath(),
    mediaUrl,
    privacyVault: requirePrivacyVault(),
  });
}

function updateLocalEntity(entityType, entityId, patch) {
  return requireEntityStore().update(entityType, entityId, patch);
}

function deleteLocalEntity(entityType, entityId) {
  return requireEntityStore().delete(entityType, entityId);
}

function closeDatabase() {
  const database = activeDatabase;
  const privacyVault = activePrivacyVault;
  activeDatabase = null;
  activeDatabasePath = null;
  activePrivacyVault = null;
  activeEntityStore = null;
  activeCourseStore = null;
  if (privacyVault) privacyVault.close();
  if (database) database.close();
}

function initializeDatabase(libraryPath, { privacyProtector, skipRestoreRecovery = false } = {}) {
  if (typeof libraryPath !== 'string' || !libraryPath.trim()) {
    throw new Error('A valid Berean Library location is required before opening the database.');
  }

  const databaseFolder = path.join(path.resolve(libraryPath), 'Database');
  const folderStats = fs.statSync(databaseFolder);
  if (!folderStats.isDirectory()) {
    throw new Error('The Berean Library Database folder is unavailable.');
  }

  const nextDatabasePath = path.join(databaseFolder, DATABASE_FILE_NAME);
  if (activeDatabase && activeDatabasePath === nextDatabasePath) {
    const privacy = unlockPrivacyAutomatically();
    return {
      path: activeDatabasePath,
      privacy,
      schemaVersion: currentSchemaVersion(),
    };
  }

  closeDatabase();
  if (!skipRestoreRecovery) recoverInterruptedRestore(nextDatabasePath);
  const database = new DatabaseSync(nextDatabasePath);
  let privacyVault = null;

  try {
    database.exec('PRAGMA foreign_keys = ON');
    database.exec('PRAGMA journal_mode = WAL');
    database.exec('PRAGMA synchronous = FULL');
    database.exec('PRAGMA busy_timeout = 5000');
    database.exec('PRAGMA secure_delete = ON');
    database.exec('PRAGMA trusted_schema = OFF');
    const schemaVersion = applyMigrations(database);
    const privacyResult = PrivacyVault.attach({
      database,
      databasePath: nextDatabasePath,
      protector: privacyProtector,
    });
    privacyVault = privacyResult.vault;
    if (!privacyResult.created && privacyResult.vault.getProtectionMode() === 'automatic') {
      privacyResult.vault.unlockAutomatically();
    }

    if (process.platform !== 'win32') fs.chmodSync(nextDatabasePath, 0o600);
    activeDatabase = database;
    activeDatabasePath = nextDatabasePath;
    activePrivacyVault = privacyResult.vault;
    activeEntityStore = new LocalEntityStore(database, privacyResult.vault);
    activeCourseStore = new CourseStore(database, privacyResult.vault);

    return {
      path: nextDatabasePath,
      privacy: {
        ...privacyResult.vault.getStatus(),
        created: privacyResult.created,
      },
      schemaVersion,
    };
  } catch (error) {
    if (privacyVault) privacyVault.close();
    database.close();
    throw error;
  }
}

module.exports = {
  activateInstallation,
  applyMigrations,
  changePrivacyPin,
  closeDatabase,
  createLocalBackup,
  createLocalEntity,
  DATABASE_FILE_NAME,
  deleteLocalImage,
  deleteLocalEntity,
  disablePrivacyPin,
  enablePrivacyPin,
  getActivationState,
  getActiveLibraryPath,
  getLocalOwner,
  getLocalEntity,
  getLocalDatabaseSummary,
  getLocalBackupFolder,
  getPrivacyStatus,
  importKnowledgeWebGraph,
  installCoursePackage,
  installCourseVersion,
  initializeDatabase,
  inspectLocalBackupForRestore,
  lockPrivacyVault,
  listCourseLibrary,
  listLocalEntities,
  readPrivateRecord,
  readLocalMedia,
  resolveCourseAsset,
  reorderLocalEntities,
  restoreKnowledgeWebGraph,
  restoreLocalBackup,
  saveCourseProgress,
  saveLocalImage,
  replacePrivacyRecoveryCode,
  savePrivateRecord,
  unlockPrivacyAutomatically,
  unlockPrivacyWithPin,
  unlockPrivacyWithRecoveryCode,
  updateLocalEntity,
  updateLocalOwner,
};
