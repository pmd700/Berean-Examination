'use strict';
const SHARED_PREFERENCES = new Set(['interlinear_words','scripture_annotation_display','scripture_favorite_bible','theme','text_size','scripture_notes_text_size','favorite_bible','favorite_bible_id','interlinear_mode','interlinear_source','annotation_display_style','chart_mode','chart_timeframe']);
const DEVICE_PREFERENCE = /workspace|viewport|scroll|collapsed|keybind|last_activity|nav_position|kw_autofocus/;
const AUX = {
  OwnerProfile: { table: 'local_owner', keys: ['singleton_id'] },
  PrivateRecord: { table: 'private_records', keys: ['record_id'], private: true },
  CourseVersion: { table: 'course_versions', keys: ['course_id','version'] },
  CourseCatalog: { table: 'course_catalog', keys: ['course_id'] },
  CourseModule: { table: 'course_modules', keys: ['course_id','version','module_id'] },
  CourseAsset: { table: 'course_assets', keys: ['course_id','version','asset_id'] },
  CourseLesson: { table: 'course_lessons', keys: ['course_id','version','lesson_id'] },
  CourseProgressIndex: { table: 'course_progress_index', keys: ['course_id','lesson_id'] },
  LibraryMetadata: { table: 'app_metadata', keys: ['key'] },
};
const DEVICE_PRIVATE = /credential|device_|api_key|key_cache|session/i;
function sharedOwner(row) {
  const prefs = JSON.parse(row.preferences_json || '{}'), shared = {};
  for (const [key,value] of Object.entries(prefs)) {
    if (DEVICE_PREFERENCE.test(key)) continue;
    if (!SHARED_PREFERENCES.has(key)) throw new Error(`Library preference requires a sync policy: ${key}`);
    shared[key] = value;
  }
  return { ...row, preferences_json: JSON.stringify(shared) };
}
function columns(db, config) { return db.prepare(`PRAGMA table_info(${config.table})`).all().map(row => row.name); }
function installAuxiliaryJournal(db) {
  if (!db.prepare('PRAGMA table_info(local_sync_journal)').all().some(row => row.name === 'source_metadata')) db.exec("ALTER TABLE local_sync_journal ADD COLUMN source_metadata TEXT NOT NULL DEFAULT '{}'");
  for (const [kind,config] of Object.entries(AUX)) {
    const cols = columns(db, config);
    if(kind==='OwnerProfile')db.exec('DROP TRIGGER IF EXISTS sync_aux_local_owner_update');
    for (const action of ['INSERT','UPDATE','DELETE']) {
      const src = action === 'DELETE' ? 'OLD' : 'NEW', id = `json_array(${config.keys.map(key => `${src}.${key}`).join(',')})`;
      const data = config.private ? `${src}.encrypted_payload` : `CAST(json_object(${cols.flatMap(key => [`'${key}'`,`${src}.${key}`]).join(',')}) AS BLOB)`;
      const metadata = config.private ? `json_object('record_type',${src}.record_type)` : "'{}'";
      let gate = config.private ? ` AND ${src}.record_type NOT LIKE 'device_%' AND ${src}.record_type NOT LIKE '%credential%' AND ${src}.record_type NOT LIKE '%key_cache%' AND ${src}.record_type NOT LIKE '%api_key%' AND ${src}.record_type NOT LIKE '%session%'` : '';
      if(kind==='OwnerProfile'&&action==='UPDATE'){
        const existingOwner=db.prepare('SELECT preferences_json FROM local_owner WHERE singleton_id=1').get();
        const deviceKeys=new Set(['bex_workspace_tabs_v1','last_activity','nav_position','kw_autofocus','kw_card_details_collapsed','study_canvas_keybinds','keybinds_web','keybinds_note','keybinds_study']);
        for(const key of Object.keys(JSON.parse(existingOwner?.preferences_json||'{}')))if(DEVICE_PREFERENCE.test(key))deviceKeys.add(key);
        const paths=Array.from(deviceKeys,key=>{if(!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key))throw new Error('Invalid local preference key.');return `'$.${key}'`;}).join(',');
        // Built-in JSON functions remain safe with trusted_schema=OFF. Avoid
        // virtual tables or application-defined SQL functions inside triggers.
        gate=` AND (NEW.display_name IS NOT OLD.display_name OR NEW.avatar_path IS NOT OLD.avatar_path OR json_remove(NEW.preferences_json,${paths}) IS NOT json_remove(OLD.preferences_json,${paths}))`;
      }
      db.exec(`CREATE TRIGGER IF NOT EXISTS sync_aux_${config.table}_${action.toLowerCase()} AFTER ${action} ON ${config.table}
        WHEN (SELECT enabled=1 AND suppress=0 FROM local_sync_config WHERE id=1)${gate} BEGIN
        INSERT INTO local_sync_journal(kind,record_id,action,encrypted_payload,created_at,updated_at,parents,source_metadata)
        VALUES('${kind}',${id},'${action === 'DELETE' ? 'delete' : 'put'}',${data},'auxiliary','auxiliary',COALESCE((SELECT heads FROM local_sync_heads WHERE kind='${kind}' AND record_id=${id}),'[]'),${metadata});
        INSERT INTO local_sync_heads VALUES('${kind}',${id},json_array(json_extract((SELECT identity FROM local_sync_config WHERE id=1),'$.deviceId')||':'||last_insert_rowid())) ON CONFLICT(kind,record_id) DO UPDATE SET heads=excluded.heads;
        END;`);
    }
  }
}
function bootstrapAuxiliaryJournal(db, vault, identity) {
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const [kind, config] of Object.entries(AUX)) {
      for (const row of db.prepare(`SELECT * FROM ${config.table}`).all()) {
        if (config.private && DEVICE_PRIVATE.test(row.record_type)) continue;
        const id = JSON.stringify(config.keys.map(key => row[key]));
        if (db.prepare('SELECT 1 FROM local_sync_heads WHERE kind=? AND record_id=?').get(kind,id)) continue;
        const data = config.private ? row.encrypted_payload : Buffer.from(JSON.stringify(row));
        const metadata = JSON.stringify(config.private ? { record_type: row.record_type } : {});
        // Validate policy before enrollment publishes any content.
        decodeAuxiliary({ kind, record_id: id, encrypted_payload: data, source_metadata: metadata }, vault);
        const result = db.prepare("INSERT INTO local_sync_journal(kind,record_id,action,encrypted_payload,created_at,updated_at,parents,source_metadata) VALUES(?,?,'put',?,'auxiliary','auxiliary','[]',?)").run(kind,id,data,metadata);
        db.prepare('INSERT INTO local_sync_heads VALUES(?,?,?)').run(kind,id,JSON.stringify([`${identity.deviceId}:${result.lastInsertRowid}`]));
      }
    }
    db.exec('COMMIT');
  } catch(error) { db.exec('ROLLBACK'); throw error; }
}
function decodeAuxiliary(row, vault) {
  const config = AUX[row.kind];
  if (!config) throw new Error('Unknown auxiliary record.');
  if (config.private) {
    const type = JSON.parse(row.source_metadata).record_type;
    if(type!=='course_progress')throw new Error('This private record type requires a sync policy before upload.');
    if (DEVICE_PRIVATE.test(type)) throw new Error('Device credentials cannot be synchronized.');
    return { record_id: JSON.parse(row.record_id)[0], record_type: type, value: vault.decryptValue(row.encrypted_payload, `bex:private-record:v1:${type}:${JSON.parse(row.record_id)[0]}`) };
  }
  const value = JSON.parse(Buffer.from(row.encrypted_payload).toString('utf8'));
  if (row.kind === 'OwnerProfile') return sharedOwner(value);
  if (row.kind === 'LibraryMetadata') throw new Error('Unclassified application metadata requires review before synchronization.');
  if (row.kind === 'CourseCatalog') return { ...value, install_state: 'available', download_bytes: 0, downloaded_bytes: 0 };
  return value;
}
function applyAuxiliary(db, vault, record) {
  const kind = record.record.kind, config = AUX[kind], key = JSON.parse(record.record.id);
  if (!Array.isArray(key) || key.length !== config.keys.length) throw new Error('Invalid auxiliary identity.');
  if (record.status === 'deleted') { db.prepare(`DELETE FROM ${config.table} WHERE ${config.keys.map(name => `${name}=?`).join(' AND ')}`).run(...key); return; }
  let value = record.versions[0].payload;
  if (config.private) {
    if (value.record_id !== key[0] || DEVICE_PRIVATE.test(value.record_type)) throw new Error('Invalid synchronized private record.');
    vault.saveRecord(value.record_id, value.record_type, value.value); return;
  }
  if (kind === 'LibraryMetadata') throw new Error('Unclassified metadata cannot be applied.');
  if (kind === 'OwnerProfile') {
    const safe = sharedOwner(value), local = db.prepare('SELECT * FROM local_owner WHERE singleton_id=1').get();
    if (!local) throw new Error('Activate the local owner before applying library preferences.');
    const localPrefs = JSON.parse(local.preferences_json);
    for (const name of SHARED_PREFERENCES) delete localPrefs[name];
    Object.assign(localPrefs, JSON.parse(safe.preferences_json));
    db.prepare('UPDATE local_owner SET display_name=?,avatar_path=?,preferences_json=?,updated_at=? WHERE singleton_id=1').run(safe.display_name,safe.avatar_path,JSON.stringify(localPrefs),safe.updated_at); return;
  }
  if (kind === 'CourseCatalog') {
    const local = db.prepare('SELECT * FROM course_catalog WHERE course_id=?').get(key[0]);
    value = { ...value, install_state: local?.install_state || 'available', download_bytes: local?.download_bytes || 0, downloaded_bytes: local?.downloaded_bytes || 0 };
  }
  const cols = columns(db, config);
  if (cols.some(name => !Object.hasOwn(value,name)) || config.keys.some((name,index) => value[name] !== key[index])) throw new Error('An auxiliary payload changed its identity or schema.');
  db.prepare(`INSERT INTO ${config.table}(${cols.join(',')}) VALUES(${cols.map(() => '?').join(',')}) ON CONFLICT(${config.keys.join(',')}) DO UPDATE SET ${cols.filter(name => !config.keys.includes(name)).map(name => `${name}=excluded.${name}`).join(',')}`).run(...cols.map(name => value[name]));
}
module.exports = { AUX, installAuxiliaryJournal, bootstrapAuxiliaryJournal, decodeAuxiliary, applyAuxiliary, sharedOwner, SHARED_PREFERENCES };
