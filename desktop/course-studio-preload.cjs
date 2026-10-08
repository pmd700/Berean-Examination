'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('bexCourseStudio', Object.freeze({
  chooseAsset: (projectId, kind) => ipcRenderer.invoke('course-studio:choose-asset', projectId, kind),
  createProject: () => ipcRenderer.invoke('course-studio:create'),
  exportPackage: (project) => ipcRenderer.invoke('course-studio:export-package', project),
  isCourseStudio: true,
  listRecentProjects: () => ipcRenderer.invoke('course-studio:recent'),
  openProject: () => ipcRenderer.invoke('course-studio:open'),
  openRecentProject: (folder) => ipcRenderer.invoke('course-studio:open-recent', folder),
  publishBeta: (packageFolder, catalogFolder) => ipcRenderer.invoke('course-studio:publish-beta', packageFolder, catalogFolder),
  publishingStatus: (catalogFolder, courseId) => ipcRenderer.invoke('course-studio:publishing-status', catalogFolder, courseId),
  saveProject: (project) => ipcRenderer.invoke('course-studio:save', project),
  saveProjectNow: (project) => ipcRenderer.sendSync('course-studio:save-now', project),
  validateProject: (project) => ipcRenderer.invoke('course-studio:validate', project),
  setChannelVersion: (catalogFolder, courseId, version, channel) => ipcRenderer.invoke('course-studio:set-channel-version', catalogFolder, courseId, version, channel),
}));
