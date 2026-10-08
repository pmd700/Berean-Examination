'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { catalogLibrary, readPublishedCatalog, readPublishedManifest } = require('../course-platform/local-course-publisher.cjs');

class LocalCourseCatalogConnection {
  constructor({ configPath, verifySignature }) {
    this.configPath = configPath;
    this.verifySignature = verifySignature;
  }

  configuredFolder() {
    try {
      const value = JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
      return typeof value.catalogFolder === 'string' ? value.catalogFolder : '';
    } catch { return ''; }
  }

  connect(folder) {
    const catalogFolder = fs.realpathSync(folder);
    const library = catalogLibrary({ catalogRoot: catalogFolder, channel: 'stable', verifySignature: this.verifySignature });
    fs.mkdirSync(path.dirname(this.configPath), { recursive: true });
    const temporary = this.configPath + '.tmp-' + crypto.randomUUID();
    fs.writeFileSync(temporary, JSON.stringify({ catalogFolder }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    fs.renameSync(temporary, this.configPath);
    return { catalogFolder, library };
  }

  read() {
    const catalogFolder = this.configuredFolder();
    if (!catalogFolder) return null;
    try { return catalogLibrary({ catalogRoot: catalogFolder, channel: 'stable', verifySignature: this.verifySignature }); }
    catch (error) {
      if (error?.code === 'ENOENT') return null;
      throw error;
    }
  }

  merge(installedLibrary) {
    const published = this.read();
    if (!published) return { ...installedLibrary, localCatalogConnected: false };
    const installed = new Map(installedLibrary.courses.map((course) => [course.id, course]));
    const courses = [...installedLibrary.courses];
    for (const course of published.courses) {
      const current = installed.get(course.id);
      if (!current) courses.push({ ...course, installState: 'available' });
      else if (current.version !== course.version) {
        const index = courses.findIndex((entry) => entry.id === course.id);
        courses[index] = { ...course, installState: 'update_available', installedVersion: current.version };
      }
    }
    return { ...installedLibrary, courses, catalogCheckedAt: published.catalogCheckedAt, localCatalogConnected: true, localCatalogFolder: published.catalogRoot };
  }

  packageFor(courseId) {
    const published = this.read();
    const course = published?.courses.find((entry) => entry.id === courseId);
    if (!course) { const error = new Error('That course is not in the connected Stable catalog.'); error.code = 'BEX_COURSE_NOT_FOUND'; throw error; }
    return course.packagePath;
  }

  deliveryFor(courseId) {
    const catalogFolder = this.configuredFolder();
    if (!catalogFolder) { const error = new Error('Connect a Course catalog first.'); error.code = 'BEX_COURSE_NOT_FOUND'; throw error; }
    const catalogRoot = fs.realpathSync(catalogFolder);
    const catalog = readPublishedCatalog(catalogRoot, 'stable', this.verifySignature);
    const entry = catalog.courses.find((item) => item.courseId === courseId);
    if (!entry) { const error = new Error('That course is not in the connected Stable catalog.'); error.code = 'BEX_COURSE_NOT_FOUND'; throw error; }
    const manifest = readPublishedManifest(catalogRoot, entry.manifestPath, entry.manifestSha256, this.verifySignature);
    if (manifest.courseId !== entry.courseId || manifest.version !== entry.version) {
      const error = new Error('The signed Course catalog points to the wrong manifest.');
      error.code = 'BEX_COURSE_CATALOG_INVALID';
      throw error;
    }
    return { catalogRoot, catalogUpdatedAt: catalog.updatedAt, entry, manifest };
  }
}

module.exports = { LocalCourseCatalogConnection };
