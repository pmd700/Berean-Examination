import { registerPendingEditorSave } from '../../../src/lib/pendingEditorSaves';

// Imports participate in the same lock/update barrier as rich-text autosave.
export async function savePhoneTask(task) {
  const promise=Promise.resolve().then(task),unregister=registerPendingEditorSave(async()=>{await promise;return true;});
  try{return await promise;}finally{unregister();}
}
