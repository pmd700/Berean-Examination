let deviceBackend=null;
export function installLocalBibleBackend(backend){deviceBackend=backend;}
function requireDesktopBible() {
  if(deviceBackend)return deviceBackend;
  const desktopApi = typeof window === 'undefined' ? null : window.bexDesktop;
  if (!desktopApi?.isDesktop || typeof desktopApi.getLocalBibleChapter !== 'function') {
    throw new Error('Local Bible files are available only inside the BEX desktop app.');
  }
  return desktopApi;
}

export const LOCAL_BIBLE_OPTIONS = Object.freeze([
  { value: 'BSB', label: 'BSB - Berean Standard Bible' },
  { value: 'KJV', label: 'KJV - King James Version' },
  { value: 'AKJV', label: 'AKJV - American King James Version' },
  { value: 'ASV', label: 'ASV - American Standard Version' },
  { value: 'BAB', label: 'BAB - Berean Annotated Bible' },
  { value: 'BGB', label: 'BGB - Berean Greek Bible (New Testament)' },
  { value: 'BIB', label: 'BIB - Berean Interlinear Bible (New Testament)' },
  { value: 'BLB', label: 'BLB - Berean Literal Bible' },
  { value: 'BRB', label: "BRB - Berean Reader's Bible" },
  { value: 'CPDV', label: 'CPDV - Catholic Public Domain Version' },
  { value: 'DBT', label: 'DBT - Darby Bible Translation' },
  { value: 'DRB', label: 'DRB - Douay-Rheims Bible' },
  { value: 'ERV', label: 'ERV - English Revised Version' },
  { value: 'JPS', label: 'JPS 1917 Tanakh / Weymouth New Testament' },
  { value: 'LSV', label: 'LSV - Literal Standard Version' },
  { value: 'MSB', label: 'MSB - Majority Standard Bible' },
  { value: 'SLT', label: "SLT - Smith's Literal Translation" },
  { value: 'WBT', label: "WBT - Webster's Bible Translation" },
  { value: 'WEB', label: 'WEB - World English Bible' },
  { value: 'YLT', label: "YLT - Young's Literal Translation" },
]);

const LOCAL_BIBLE_VERSION_SET = new Set(LOCAL_BIBLE_OPTIONS.map((option) => option.value));
const NEW_TESTAMENT_ONLY_VERSION_SET = new Set(['BGB', 'BIB']);

export function isLocalBibleVersion(version) {
  return LOCAL_BIBLE_VERSION_SET.has(String(version || '').trim().toUpperCase());
}

export function isNewTestamentOnlyBibleVersion(version) {
  return NEW_TESTAMENT_ONLY_VERSION_SET.has(String(version || '').trim().toUpperCase());
}

export async function readLocalBibleChapter(version, book, chapter) {
  const result = await requireDesktopBible().getLocalBibleChapter({ version, book, chapter });
  if (!result?.ok || !result.chapter?.text) {
    const error = new Error(result?.error || 'BEX could not read that local Bible chapter.');
    error.code = result?.code || null;
    throw error;
  }
  return result.chapter;
}
