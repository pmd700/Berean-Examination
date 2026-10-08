function api() {
  if (!window.bexCourseStudio?.isCourseStudio) throw new Error('Open this screen through BEX Course Studio.');
  return window.bexCourseStudio;
}

async function unwrap(promise, fallback) {
  const result = await promise;
  if (!result?.ok) throw new Error(result?.error || fallback);
  return result;
}

export const listRecentProjects = () => unwrap(api().listRecentProjects(), 'Recent projects could not be read.');
export const createProject = () => unwrap(api().createProject(), 'The project could not be created.');
export const exportPackage = (project) => unwrap(api().exportPackage(project), 'The package could not be exported.');
export const openProject = () => unwrap(api().openProject(), 'The project could not be opened.');
export const openRecentProject = (folder) => unwrap(api().openRecentProject(folder), 'The project could not be reopened.');
export const publishBeta = (packageFolder, catalogFolder) => unwrap(api().publishBeta(packageFolder, catalogFolder), 'The Beta could not be published.');
export const publishingStatus = (catalogFolder, courseId) => unwrap(api().publishingStatus(catalogFolder, courseId), 'Publishing status could not be read.');
export const saveProject = (project) => unwrap(api().saveProject(project), 'The project could not be saved.');
export function saveProjectNow(project) {
  const result = api().saveProjectNow(project);
  if (!result?.ok) throw new Error(result?.error || 'The project could not be saved.');
  return result.project;
}
export const chooseAsset = (projectId, kind) => unwrap(api().chooseAsset(projectId, kind), 'That file could not be selected.');
export const validateProject = (project) => unwrap(api().validateProject(project), 'The project could not be validated.');
export const setChannelVersion = (catalogFolder, courseId, version, channel) => unwrap(api().setChannelVersion(catalogFolder, courseId, version, channel), 'The catalog version could not be changed.');
