'use strict';

const COURSE_INSTALL_STATES = new Set([
  'available',
  'downloading',
  'installed',
  'update_available',
]);
const COURSE_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{1,79}$/;
const VERSION_PATTERN = /^[0-9]+(?:\.[0-9]+){0,3}(?:-[a-z0-9.-]+)?$/i;
const SHA256_PATTERN = /^[a-f0-9]{64}$/i;
const MIME_PATTERN = /^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/i;
const PROGRESS_RECORD_TYPE = 'course_progress';
const { createCourseMediaUrl } = require('./course-media-protocol.cjs');

function codedError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function requiredText(value, label, maxLength = 500) {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) {
    throw codedError('BEX_COURSE_INVALID', label + ' is invalid.');
  }
  return value.trim();
}

function optionalText(value, label, maxLength = 10000) {
  if (value == null || value === '') return '';
  if (typeof value !== 'string' || value.length > maxLength) {
    throw codedError('BEX_COURSE_INVALID', label + ' is invalid.');
  }
  return value.trim();
}

function nonNegativeInteger(value, label) {
  const parsed = Number(value ?? 0);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw codedError('BEX_COURSE_INVALID', label + ' is invalid.');
  }
  return parsed;
}

function stableId(value, label) {
  const id = requiredText(value, label, 80).toLowerCase();
  if (!COURSE_ID_PATTERN.test(id)) {
    throw codedError('BEX_COURSE_INVALID', label + ' must be a stable lowercase identifier.');
  }
  return id;
}

function courseVersion(value) {
  const version = requiredText(value, 'Course version', 80);
  if (!VERSION_PATTERN.test(version)) {
    throw codedError('BEX_COURSE_INVALID', 'Course version is invalid.');
  }
  return version;
}

function installState(value) {
  const state = value || 'installed';
  if (!COURSE_INSTALL_STATES.has(state)) {
    throw codedError('BEX_COURSE_INVALID', 'Course installation state is invalid.');
  }
  return state;
}

function safeArtworkUrl(value) {
  const artworkUrl = optionalText(value, 'Course artwork URL', 500);
  if (artworkUrl && !artworkUrl.startsWith('bex-course://')) {
    throw codedError('BEX_COURSE_INVALID', 'Course artwork must use protected BEX course media.');
  }
  return artworkUrl;
}

function safeRelativePath(value) {
  const relativePath = requiredText(value, 'Course asset path', 500).replaceAll('\\', '/');
  if (
    relativePath.startsWith('/')
    || relativePath.includes('../')
    || relativePath === '..'
    || relativePath.includes('\0')
  ) {
    throw codedError('BEX_COURSE_INVALID', 'Course asset path is unsafe.');
  }
  return relativePath;
}

function progressRecordId(courseId, lessonId) {
  const recordId = 'course-progress:' + courseId + ':' + lessonId;
  if (recordId.length > 200) {
    throw codedError('BEX_COURSE_INVALID', 'Course progress identity is too long.');
  }
  return recordId;
}

function normalizeCourseDefinition(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw codedError('BEX_COURSE_INVALID', 'Course data is invalid.');
  }

  const id = stableId(input.id || input.courseId, 'Course ID');
  const version = courseVersion(input.version);
  const state = installState(input.installState);
  const modulesInput = Array.isArray(input.modules) ? input.modules : [];
  const moduleIds = new Set();
  const lessonIds = new Set();
  const modules = modulesInput.map((module, modulePosition) => {
    const moduleId = stableId(module?.id, 'Module ID');
    if (moduleIds.has(moduleId)) {
      throw codedError('BEX_COURSE_INVALID', 'Course module IDs must be unique.');
    }
    moduleIds.add(moduleId);
    const lessonsInput = Array.isArray(module?.lessons) ? module.lessons : [];
    const lessons = lessonsInput.map((lesson, lessonPosition) => {
      const lessonId = stableId(lesson?.id, 'Lesson ID');
      if (lessonIds.has(lessonId)) {
        throw codedError('BEX_COURSE_INVALID', 'Course lesson IDs must be unique.');
      }
      lessonIds.add(lessonId);
      const mediaAssetId = lesson?.mediaAssetId
        ? stableId(lesson.mediaAssetId, 'Lesson media asset ID')
        : '';
      const posterAssetId = lesson?.posterAssetId
        ? stableId(lesson.posterAssetId, 'Lesson poster asset ID')
        : '';
      return {
        id: lessonId,
        title: requiredText(lesson?.title, 'Lesson title', 300),
        description: optionalText(lesson?.description, 'Lesson description', 20000),
        durationSeconds: nonNegativeInteger(lesson?.durationSeconds, 'Lesson duration'),
        mediaAssetId,
        posterAssetId,
        position: lessonPosition,
      };
    });
    return {
      id: moduleId,
      title: requiredText(module?.title, 'Module title', 300),
      description: optionalText(module?.description, 'Module description', 10000),
      position: modulePosition,
      lessons,
    };
  });

  const assetIds = new Set();
  const assetsInput = Array.isArray(input.assets) ? input.assets : [];
  const assets = assetsInput.map((asset) => {
    const assetId = stableId(asset?.id, 'Course asset ID');
    if (assetIds.has(assetId)) {
      throw codedError('BEX_COURSE_INVALID', 'Course asset IDs must be unique.');
    }
    assetIds.add(assetId);
    const sha256 = requiredText(asset?.sha256, 'Course asset fingerprint', 64).toLowerCase();
    if (!SHA256_PATTERN.test(sha256)) {
      throw codedError('BEX_COURSE_INVALID', 'Course asset fingerprint is invalid.');
    }
    const mimeType = requiredText(asset?.mimeType, 'Course asset media type', 120).toLowerCase();
    if (!MIME_PATTERN.test(mimeType)) {
      throw codedError('BEX_COURSE_INVALID', 'Course asset media type is invalid.');
    }
    return {
      id: assetId,
      role: requiredText(asset?.role || 'attachment', 'Course asset role', 40).toLowerCase(),
      sha256,
      byteSize: nonNegativeInteger(asset?.byteSize, 'Course asset size'),
      mimeType,
      relativePath: safeRelativePath(asset?.relativePath),
    };
  });

  for (const module of modules) {
    for (const lesson of module.lessons) {
      for (const assetId of [lesson.mediaAssetId, lesson.posterAssetId]) {
        if (assetId && !assetIds.has(assetId)) {
          throw codedError('BEX_COURSE_INVALID', 'A lesson references a missing course asset.');
        }
      }
    }
  }

  const timestamp = optionalText(input.updatedAt, 'Course update time', 80)
    || new Date().toISOString();
  const accent = optionalText(input.accent, 'Course accent', 20) || '#8B6BC2';
  if (!/^#[a-f0-9]{6}$/i.test(accent)) {
    throw codedError('BEX_COURSE_INVALID', 'Course accent color is invalid.');
  }

  return {
    id,
    version,
    title: requiredText(input.title, 'Course title', 300),
    description: optionalText(input.description, 'Course description', 20000),
    author: optionalText(input.author, 'Course author', 300) || 'Berean Examination',
    artworkUrl: safeArtworkUrl(input.artworkUrl),
    accent,
    installState: state,
    downloadBytes: nonNegativeInteger(input.downloadBytes, 'Course download size'),
    downloadedBytes: nonNegativeInteger(input.downloadedBytes, 'Downloaded course size'),
    releaseNotes: optionalText(input.releaseNotes, 'Course release notes', 10000),
    sourceManifestJson: optionalText(
      input.sourceManifestJson,
      'Source Course manifest',
      1024 * 1024,
    ),
    manifestSignature: optionalText(input.manifestSignature, 'Course signature', 4096),
    updatedAt: timestamp,
    modules,
    assets,
  };
}

class CourseStore {
  constructor(database, privacyVault) {
    if (!database || typeof database.prepare !== 'function') {
      throw new TypeError('The Course store requires an open SQLite database.');
    }
    if (!privacyVault || typeof privacyVault.readRecord !== 'function') {
      throw new TypeError('The Course store requires the Berean privacy vault.');
    }
    this.database = database;
    this.privacyVault = privacyVault;
  }

  listLibrary() {
    const courses = this.database.prepare(`
      SELECT
        course_id, active_version, title, description, author, artwork_url,
        accent, install_state, download_bytes, downloaded_bytes, updated_at
      FROM course_catalog
      ORDER BY position ASC, title COLLATE NOCASE ASC
    `).all();
    const moduleStatement = this.database.prepare(`
      SELECT module_id, title, description, position
      FROM course_modules
      WHERE course_id = ? AND version = ?
      ORDER BY position ASC
    `);
    const lessonStatement = this.database.prepare(`
      SELECT
        lesson_id, module_id, title, description, duration_seconds,
        media_asset_id, poster_asset_id, position
      FROM course_lessons
      WHERE course_id = ? AND version = ?
      ORDER BY module_position ASC, position ASC
    `);
    const assetStatement = this.database.prepare(`
      SELECT asset_id, role, sha256, byte_size, mime_type
      FROM course_assets
      WHERE course_id = ? AND version = ?
    `);
    const releaseStatement = this.database.prepare(`
      SELECT release_notes, manifest_json
      FROM course_versions
      WHERE course_id = ? AND version = ?
    `);

    const records = courses.map((course) => {
      const modules = moduleStatement.all(course.course_id, course.active_version).map((module) => ({
        id: module.module_id,
        title: module.title,
        description: module.description,
        position: Number(module.position),
        lessons: [],
      }));
      const moduleMap = new Map(modules.map((module) => [module.id, module]));
      const lessons = lessonStatement.all(course.course_id, course.active_version);
      const assets = assetStatement.all(course.course_id, course.active_version);
      const assetMap = new Map(assets.map((asset) => [asset.asset_id, asset]));
      const release = releaseStatement.get(course.course_id, course.active_version);
      let sourceManifest = null;
      try {
        const parsedManifest = JSON.parse(release?.manifest_json || 'null');
        if (parsedManifest?.format === 'bex-course' && parsedManifest?.manifestVersion === 1) {
          sourceManifest = parsedManifest;
        }
      } catch {
        // Old development fixtures have no Course Manifest v1 extras.
      }
      const sourceLessonMap = new Map(
        (sourceManifest?.modules || []).flatMap((module) => module.lessons || [])
          .map((lesson) => [lesson.id, lesson]),
      );
      const publicAsset = (assetId) => {
        const asset = assetMap.get(assetId);
        if (!asset) return null;
        return {
          id: asset.asset_id,
          role: asset.role,
          mimeType: asset.mime_type,
          byteSize: Number(asset.byte_size),
          url: createCourseMediaUrl(course.course_id, course.active_version, asset.asset_id),
        };
      };
      let completedLessons = 0;

      for (const lesson of lessons) {
        const savedProgress = this.privacyVault.readRecord(
          progressRecordId(course.course_id, lesson.lesson_id),
        );
        const durationSeconds = Number(lesson.duration_seconds);
        const progressSeconds = Math.min(
          durationSeconds || Number.MAX_SAFE_INTEGER,
          Math.max(0, Number(savedProgress?.progressSeconds || 0)),
        );
        const completed = Boolean(savedProgress?.completed);
        const sourceLesson = sourceLessonMap.get(lesson.lesson_id) || {};
        const media = publicAsset(lesson.media_asset_id);
        const poster = publicAsset(lesson.poster_asset_id);
        const captions = (sourceLesson.captionAssetIds || [])
          .map(publicAsset)
          .filter(Boolean)
          .map((caption, index) => ({
            ...caption,
            label: index === 0 ? 'Captions' : 'Captions ' + (index + 1),
            language: sourceManifest?.language || 'en',
          }));
        if (completed) completedLessons += 1;
        moduleMap.get(lesson.module_id)?.lessons.push({
          id: lesson.lesson_id,
          title: lesson.title,
          description: lesson.description,
          durationSeconds,
          progressSeconds,
          completed,
          mediaUrl: media?.url || '',
          mediaMimeType: media?.mimeType || '',
          posterUrl: poster?.url || '',
          captions,
          position: Number(lesson.position),
        });
      }

      const lessonCount = lessons.length;
      const progressPercent = lessonCount
        ? Math.round((completedLessons / lessonCount) * 100)
        : 0;
      const artwork = publicAsset(sourceManifest?.artworkAssetId);
      return {
        id: course.course_id,
        version: course.active_version,
        title: course.title,
        description: course.description,
        author: course.author,
        artworkUrl: artwork?.url || course.artwork_url,
        accent: course.accent,
        installState: course.install_state,
        downloadBytes: Number(course.download_bytes),
        downloadedBytes: Number(course.downloaded_bytes),
        progressPercent,
        completedLessons,
        modules,
        updatedAt: course.updated_at,
        releaseNotes: release?.release_notes || '',
      };
    });

    return {
      courses: records,
      catalogCheckedAt: '',
      onlineModeEnabled: false,
    };
  }

  resolveAsset({ courseId, version, assetId }) {
    const normalizedCourseId = stableId(courseId, 'Course ID');
    const normalizedVersion = courseVersion(version);
    const normalizedAssetId = stableId(assetId, 'Course asset ID');
    const asset = this.database.prepare(`
      SELECT assets.relative_path, assets.mime_type, assets.byte_size
      FROM course_assets AS assets
      JOIN course_catalog AS catalog
        ON catalog.course_id = assets.course_id
       AND catalog.active_version = assets.version
      WHERE assets.course_id = ?
        AND assets.version = ?
        AND assets.asset_id = ?
        AND catalog.install_state = 'installed'
    `).get(normalizedCourseId, normalizedVersion, normalizedAssetId);
    if (!asset) {
      throw codedError('BEX_COURSE_ASSET_NOT_FOUND', 'That installed Course file was not found.');
    }
    return {
      relativePath: asset.relative_path,
      mimeType: asset.mime_type,
      byteSize: Number(asset.byte_size),
    };
  }

  installCourseVersion(input) {
    const course = normalizeCourseDefinition(input);
    const timestamp = course.updatedAt;
    const manifestJson = course.sourceManifestJson || JSON.stringify(course);
    const existingVersion = this.database.prepare(`
      SELECT manifest_json
      FROM course_versions
      WHERE course_id = ? AND version = ?
    `).get(course.id, course.version);
    if (existingVersion && existingVersion.manifest_json !== manifestJson) {
      throw codedError(
        'BEX_COURSE_VERSION_CONFLICT',
        'A published course version cannot be silently changed. Use a new version number.',
      );
    }
    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.database.prepare(`
        INSERT INTO course_versions (
          course_id, version, manifest_version, manifest_json, manifest_signature,
          release_notes, total_bytes, published_at, created_at
        ) VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(course_id, version) DO NOTHING
      `).run(
        course.id,
        course.version,
        manifestJson,
        course.manifestSignature || null,
        course.releaseNotes,
        course.downloadBytes,
        timestamp,
        timestamp,
      );

      const existingPosition = this.database.prepare(
        'SELECT position FROM course_catalog WHERE course_id = ?',
      ).get(course.id);
      const nextPosition = existingPosition
        ? Number(existingPosition.position)
        : Number(this.database.prepare('SELECT COUNT(*) AS count FROM course_catalog').get().count);
      this.database.prepare(`
        INSERT INTO course_catalog (
          course_id, active_version, title, description, author, artwork_url,
          accent, install_state, download_bytes, downloaded_bytes, position,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(course_id) DO UPDATE SET
          active_version = excluded.active_version,
          title = excluded.title,
          description = excluded.description,
          author = excluded.author,
          artwork_url = excluded.artwork_url,
          accent = excluded.accent,
          install_state = excluded.install_state,
          download_bytes = excluded.download_bytes,
          downloaded_bytes = excluded.downloaded_bytes,
          updated_at = excluded.updated_at
      `).run(
        course.id,
        course.version,
        course.title,
        course.description,
        course.author,
        course.artworkUrl,
        course.accent,
        course.installState,
        course.downloadBytes,
        Math.min(course.downloadBytes, course.downloadedBytes),
        nextPosition,
        timestamp,
        timestamp,
      );

      this.database.prepare(
        'DELETE FROM course_lessons WHERE course_id = ? AND version = ?',
      ).run(course.id, course.version);
      this.database.prepare(
        'DELETE FROM course_modules WHERE course_id = ? AND version = ?',
      ).run(course.id, course.version);
      this.database.prepare(
        'DELETE FROM course_assets WHERE course_id = ? AND version = ?',
      ).run(course.id, course.version);

      const insertModule = this.database.prepare(`
        INSERT INTO course_modules (
          course_id, version, module_id, title, description, position
        ) VALUES (?, ?, ?, ?, ?, ?)
      `);
      const insertLesson = this.database.prepare(`
        INSERT INTO course_lessons (
          course_id, version, lesson_id, module_id, module_position, title,
          description, duration_seconds, media_asset_id, poster_asset_id, position
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const module of course.modules) {
        insertModule.run(
          course.id,
          course.version,
          module.id,
          module.title,
          module.description,
          module.position,
        );
        for (const lesson of module.lessons) {
          insertLesson.run(
            course.id,
            course.version,
            lesson.id,
            module.id,
            module.position,
            lesson.title,
            lesson.description,
            lesson.durationSeconds,
            lesson.mediaAssetId || null,
            lesson.posterAssetId || null,
            lesson.position,
          );
        }
      }

      const insertAsset = this.database.prepare(`
        INSERT INTO course_assets (
          asset_id, course_id, version, role, sha256, byte_size, mime_type, relative_path
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const asset of course.assets) {
        insertAsset.run(
          asset.id,
          course.id,
          course.version,
          asset.role,
          asset.sha256,
          asset.byteSize,
          asset.mimeType,
          asset.relativePath,
        );
      }

      this.database.prepare(`
        INSERT INTO course_installations (
          course_id, version, state, installed_at, last_error, updated_at
        ) VALUES (?, ?, ?, ?, NULL, ?)
        ON CONFLICT(course_id, version) DO UPDATE SET
          state = excluded.state,
          installed_at = excluded.installed_at,
          last_error = NULL,
          updated_at = excluded.updated_at
      `).run(
        course.id,
        course.version,
        course.installState,
        course.installState === 'installed' ? timestamp : null,
        timestamp,
      );
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
    return this.listLibrary().courses.find((record) => record.id === course.id);
  }

  saveProgress(courseIdValue, lessonIdValue, value) {
    const courseId = stableId(courseIdValue, 'Course ID');
    const lessonId = stableId(lessonIdValue, 'Lesson ID');
    const lesson = this.database.prepare(`
      SELECT lessons.duration_seconds
      FROM course_catalog AS catalog
      JOIN course_lessons AS lessons
        ON lessons.course_id = catalog.course_id
       AND lessons.version = catalog.active_version
      WHERE catalog.course_id = ? AND lessons.lesson_id = ?
    `).get(courseId, lessonId);
    if (!lesson) {
      throw codedError('BEX_COURSE_NOT_FOUND', 'That installed course lesson was not found.');
    }
    const durationSeconds = Number(lesson.duration_seconds);
    const progressSeconds = Math.min(
      durationSeconds || Number.MAX_SAFE_INTEGER,
      nonNegativeInteger(value?.progressSeconds, 'Course progress'),
    );
    const completed = Boolean(value?.completed)
      || (durationSeconds > 0 && progressSeconds >= durationSeconds);
    const updatedAt = new Date().toISOString();
    const recordId = progressRecordId(courseId, lessonId);
    const record = {
      courseId,
      lessonId,
      progressSeconds,
      completed,
      updatedAt,
    };

    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.privacyVault.saveRecord(recordId, PROGRESS_RECORD_TYPE, record);
      this.database.prepare(`
        INSERT INTO course_progress_index (
          course_id, lesson_id, private_record_id, updated_at
        ) VALUES (?, ?, ?, ?)
        ON CONFLICT(course_id, lesson_id) DO UPDATE SET
          private_record_id = excluded.private_record_id,
          updated_at = excluded.updated_at
      `).run(courseId, lessonId, recordId, updatedAt);
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
    return record;
  }
}

module.exports = {
  CourseStore,
  normalizeCourseDefinition,
};
