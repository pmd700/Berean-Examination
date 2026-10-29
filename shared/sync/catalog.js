// Portable inventory. Adding a database table must also add an explicit policy.
// Nothing here opens the vault or decrypts an existing private Knowledge Web.
export const ENTITY_TABLES = Object.freeze({
  Asset: 'local_assets',
  Annotation: 'local_annotations',
  StudyCanvasObject: 'local_study_canvas_objects',
  StudyConnection: 'local_study_connections',
  BrainSource: 'local_brain_sources',
  ChapterArtCatalog: 'local_chapter_art_catalogs',
  KnowledgeWeb: 'local_knowledge_webs',
  WebFolder: 'local_web_folders',
  MindNote: 'local_mind_notes',
  MindLink: 'local_mind_links',
  WebVersion: 'local_web_versions',
  WebCard: 'local_web_cards',
  WebConnection: 'local_web_connections',
  CanvasObject: 'local_canvas_objects',
  DailyActivity: 'local_daily_activities',
  Drawing: 'local_drawings',
  Keyword: 'local_keywords',
  StudyChapter: 'local_study_chapters',
  Timegraph: 'local_timegraphs',
  TextHighlight: 'local_text_highlights',
});

export const AUXILIARY_TABLES = Object.freeze({
  private_records: { mode: 'split', kind: 'PrivateRecord', reason: 'Content/progress sync; key caches and device sessions stay device-scoped.' },
  local_owner: { mode: 'split', kind: 'OwnerProfile', reason: 'Profile and library preferences sync; unlock and workspace preferences are device-scoped.' },
  app_metadata: { mode: 'review', reason: 'Classify each metadata key before enrollment; no silent omission.' },
  activation_record: { mode: 'device', reason: 'Machine-bound activation requires a separate phone entitlement boundary.' },
  privacy_vault: { mode: 'device', reason: 'Keychain/PIN envelopes and failed-unlock counters must not overwrite another device.' },
  local_entity_sequences: { mode: 'device', reason: 'Replaced by reserved device ID ranges at sync enrollment, not copied between writers.' },
  schema_migrations: { mode: 'device', reason: 'Each storage adapter runs its own compatible schema migrations.' },
  course_versions: { mode: 'shared', kind: 'CourseVersion' },
  course_catalog: { mode: 'split', kind: 'CourseCatalog', reason: 'Catalog/order sync; download/install state is local to a device.' },
  course_modules: { mode: 'shared', kind: 'CourseModule' },
  course_assets: { mode: 'shared', kind: 'CourseAsset' },
  course_lessons: { mode: 'shared', kind: 'CourseLesson' },
  course_installations: { mode: 'device', reason: 'Availability is derived from this device\'s verified files, not another device\'s installed flag.' },
  course_progress_index: { mode: 'rebuild', reason: 'Rebuild from synchronized encrypted course progress records.' },
});
for (const policy of Object.values(AUXILIARY_TABLES)) Object.freeze(policy);

export const STRING_RECORD_KINDS = Object.freeze([
  'OwnerProfile', 'LibraryPreferences', 'DeviceWorkspace', 'PrivateRecord',
  'CourseVersion', 'CourseCatalog', 'CourseModule', 'CourseAsset', 'CourseLesson',
  'VaultFile',
]);

export function tablePolicy(table) {
  const entry = Object.entries(ENTITY_TABLES).find(([, name]) => name === table);
  if (entry) return { mode: 'shared', kind: entry[0] };
  return Object.hasOwn(AUXILIARY_TABLES, table) ? AUXILIARY_TABLES[table] : null;
}

export function assertTableCoverage(tables) {
  const unknown = tables.filter((name) => !name.startsWith('sqlite_') && !tablePolicy(name));
  if (unknown.length) throw new Error(`Unclassified vault tables: ${unknown.join(', ')}`);
}

export function assertVaultRelativePath(value) {
  if (typeof value !== 'string' || !value || value.length > 2048
    || /[\\\u0000-\u001f\u007f]/u.test(value)
    || value.startsWith('/') || /^[A-Za-z]:/.test(value)
    || value.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new TypeError('Invalid vault-relative path.');
  }
  return value;
}

export function vaultFilePolicy(relativePath) {
  assertVaultRelativePath(relativePath);
  const parts = relativePath.split('/');
  if (parts.at(-1) === '.DS_Store') return { mode: 'device', reason: 'Finder cache.' };
  if (parts[0] === 'Database') return { mode: 'snapshot-only', reason: 'Sync records; never mirror an open SQLite database, journal, or key envelope.' };
  const known = ['Media', 'Courses', 'Imports', 'Exports', 'Backups'].includes(parts[0]);
  // Unknown regular files are retained, with an explicit review requirement.
  // The filesystem adapter must reject symlinks/special files before calling.
  return { mode: 'shared-file', kind: 'VaultFile', review: !known };
}
