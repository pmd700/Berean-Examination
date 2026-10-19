/**
 * Bible Study export rights live here so every export surface follows the
 * same rule. Crossway told David that complete local ESV storage requires an
 * eligible formal organization or ministry; BEX is not eligible as an
 * individual-owned product. Keep this disabled unless Crossway later issues a
 * written license expressly covering both local storage and user exports.
 */
export const ESV_STUDY_EXPORT_POLICY = Object.freeze({
  enabled: false,
  status: 'Not licensed — permanently disabled for the current product',
});

export const ESV_STUDY_EXPORT_BLOCK_MESSAGE =
  'ESV exports are unavailable because BEX is not licensed to store or distribute the ESV. Your study remains saved inside BEX.';

const EXPORT_NOTICES = Object.freeze({
  AKJV: [
    'Scripture text: American King James Version (AKJV), produced by Michael Peter (Stone) Engelbrite.',
    'Placed into the public domain on November 8, 1999.',
    'https://www.stepbible.org/version.jsp?version=AKJV',
  ].join('\n'),
  ASV: [
    'Scripture text: American Standard Version (1901). Public domain.',
    'https://ebible.org/Scriptures/copyright.php',
  ].join('\n'),
  BAB: [
    'Scripture text: Berean Annotated Bible (BAB), an early draft edition.',
    'The Berean Bible texts were dedicated to the public domain on April 30, 2023.',
    'https://berean.bible/terms.htm',
  ].join('\n'),
  BGB: [
    'Scripture text: The Holy Bible, Berean Greek Bible (BGB), © 2016 by Bible Hub.',
    'The supplied source grants full-text software/app use; the Berean Bible texts were later dedicated to the public domain.',
    'https://berean.bible/terms.htm',
  ].join('\n'),
  BIB: [
    'Scripture text: The Holy Bible, Berean Interlinear Bible (BIB), © 2016 by Bible Hub.',
    'The supplied source grants full-text software/app use; the Berean Bible texts were later dedicated to the public domain.',
    'https://berean.bible/terms.htm',
  ].join('\n'),
  BLB: [
    'Scripture text: Berean Literal Bible (BLB).',
    'The Berean Bible texts were dedicated to the public domain on April 30, 2023.',
    'https://berean.bible/terms.htm',
  ].join('\n'),
  BRB: [
    'Scripture text: Berean Reader’s Bible (BRB).',
    'The current Berean Bible terms dedicate the Berean Bible texts to the public domain.',
    'https://berean.bible/terms.htm',
  ].join('\n'),
  BSB: [
    'Scripture text: Berean Standard Bible (BSB).',
    'The Berean Bible text was dedicated to the public domain on April 30, 2023.',
    'https://berean.bible/terms.htm',
  ].join('\n'),
  LSV: [
    'Scripture text: Literal Standard Version (LSV), © 2020 Covenant Press and the Covenant Christian Coalition.',
    'The LSV Scripture text is licensed under CC BY-SA 4.0. Formatting was adapted for this export; the wording was not changed.',
    'No endorsement by Covenant Press or the Covenant Christian Coalition is implied. Do not apply DRM or other legal or technological restrictions to the LSV Scripture portion.',
    'https://www.lsvbible.com/p/get-lsv.html',
    'https://creativecommons.org/licenses/by-sa/4.0/',
  ].join('\n'),
  KJV: [
    'Scripture text: King James Version (KJV).',
    'The KJV text is public domain in the United States. Crown rights administered by Cambridge University Press apply in the United Kingdom.',
    'https://www.cambridge.org/gb/rights-and-permissions/permissions',
  ].join('\n'),
  CPDV: [
    'Scripture text: Catholic Public Domain Version, translated by Ronald L. Conte Jr. Public domain.',
    'https://www.stepbible.org/version.jsp?version=CPDV',
  ].join('\n'),
  DBT: [
    'Scripture text: Darby Bible Translation, by John Nelson Darby. Public domain.',
    'https://ebible.org/Scriptures/copyright.php',
  ].join('\n'),
  DRB: [
    'Scripture text: Douay-Rheims Bible. Public domain.',
    'https://ebible.org/Scriptures/copyright.php',
  ].join('\n'),
  ERV: [
    'Scripture text: English Revised Version (1885). Public domain.',
    'https://ebible.org/Scriptures/copyright.php',
  ].join('\n'),
  JPS: [
    'Scripture text: JPS Tanakh 1917 Old Testament / Weymouth New Testament. Both component texts are public domain.',
    'https://ebible.org/Scriptures/copyright.php',
  ].join('\n'),
  MSB: [
    'Scripture text: Majority Standard Bible (MSB).',
    'The Majority Bible text was dedicated to the public domain on April 30, 2023.',
    'https://berean.bible/terms.htm',
  ].join('\n'),
  SLT: [
    'Scripture text: Smith’s Literal Translation, by Julia E. Smith (1876). Public domain.',
    'https://ebible.org/Scriptures/copyright.php',
  ].join('\n'),
  WBT: [
    'Scripture text: Webster’s Bible Translation, by Noah Webster (1833). Public domain.',
    'https://ebible.org/Scriptures/copyright.php',
  ].join('\n'),
  WEB: [
    'Scripture text: World English Bible. The text is public domain.',
    '“World English Bible” is a trademark identifying faithful copies; a changed text must use a different name.',
    'https://ebible.org/engwebp/copyright.htm',
  ].join('\n'),
  YLT: [
    'Scripture text: Young’s Literal Translation, by Robert Young. Public domain.',
    'https://ebible.org/Scriptures/copyright.php',
  ].join('\n'),
  ESV: [
    'Scripture quotations are from the ESV® Bible (The Holy Bible, English Standard Version®), © 2001 by Crossway, a publishing ministry of Good News Publishers. ESV Text Edition: 2025. Used by permission. All rights reserved.',
  ].join('\n'),
  NASB1995: [
    'Scripture text: New American Standard Bible® 1995 (NASB1995).',
    'Copyright © 1960, 1962, 1963, 1968, 1971, 1972, 1973, 1975, 1977, 1995 by The Lockman Foundation. All rights reserved.',
    'https://www.lockman.org/',
    'https://api.bible/',
  ].join('\n'),
});

export function normalizeStudyTranslation(value) {
  const normalized = String(value || '').trim().toUpperCase();
  if (normalized === 'ESV' || normalized.includes('ENGLISH STANDARD VERSION')) return 'ESV';
  if (normalized === 'BSB' || normalized.includes('BEREAN STANDARD BIBLE')) return 'BSB';
  if (normalized === 'LSV' || normalized.includes('LITERAL STANDARD VERSION')) return 'LSV';
  if (normalized === 'KJV' || normalized.includes('KING JAMES VERSION')) return 'KJV';
  if (normalized.includes('AMERICAN STANDARD VERSION')) return 'ASV';
  if (normalized.includes('WORLD ENGLISH BIBLE')) return 'WEB';
  if (normalized.includes('CATHOLIC PUBLIC DOMAIN VERSION')) return 'CPDV';
  return normalized;
}

function materialTranslation(material) {
  if (typeof material === 'string') return material;
  return material?.version ?? material?.translation ?? '';
}

export function isStudyMaterialExportAllowed(material) {
  const translation = normalizeStudyTranslation(materialTranslation(material));
  return translation !== 'ESV' || ESV_STUDY_EXPORT_POLICY.enabled;
}

export function getBlockedStudyExportTranslations(materials = []) {
  const blocked = new Set();
  for (const material of materials) {
    const translation = normalizeStudyTranslation(materialTranslation(material));
    if (translation && !isStudyMaterialExportAllowed(material)) blocked.add(translation);
  }
  return [...blocked];
}

export function assertStudyMaterialExportAllowed(materials) {
  const list = Array.isArray(materials) ? materials : [materials];
  const blocked = getBlockedStudyExportTranslations(list);
  if (blocked.length === 0) return;

  const error = new Error(ESV_STUDY_EXPORT_BLOCK_MESSAGE);
  error.code = 'BIBLE_STUDY_EXPORT_BLOCKED';
  error.translations = blocked;
  throw error;
}

export function getStudyExportRightsNotice(material) {
  const translation = normalizeStudyTranslation(materialTranslation(material));
  if (['NASB1995', 'NASB', 'NBLA'].includes(translation) && typeof material?.api_copyright === 'string' && material.api_copyright.trim()) {
    // Treat metadata as plain text, never executable API-supplied markup.
    const copyright = material.api_copyright.replace(/<[^>]*>/g, '').trim();
    const edition = translation === 'NASB1995' ? ' 1995' : '';
    const name = translation === 'NBLA' ? 'Nueva Biblia de las Américas' : `New American Standard Bible®${edition}`;
    return `Scripture text: ${name} (${translation}).\n${copyright}\nhttps://www.lockman.org/\nhttps://api.bible/`;
  }
  return EXPORT_NOTICES[translation] || '';
}
