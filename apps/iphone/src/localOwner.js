import { desktopClient } from './mobileClient';
export const readLocalOwner=()=>desktopClient.owner.read();
export const saveLocalOwnerPreferences=patch=>desktopClient.owner.updatePreferences(patch);
