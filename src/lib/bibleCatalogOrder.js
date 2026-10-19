// English sales leaders, ECPA / Circana March 2026 (latest verified list):
// https://christianbookexpo.com/bestseller/translations.php?id=0326
// This is a sales proxy for popularity, not a claim about worldwide readership.
// Unranked English editions follow alphabetically, then other languages.
const LEADERS = ['NIV', 'KJV', 'ESV', 'NLT', 'NKJV', 'CSB', 'NASB', 'NRSV'];
const ENGLISH_CODES = new Set([...LEADERS, 'BSB', 'ASV', 'WEB', 'LSV', 'LSB', 'NET', 'RSV', 'AMP', 'AMPC', 'CEV', 'GNT', 'NABRE', 'DRA', 'YLT', 'ERV', 'HCSB']);
const family = bible => {
  const code = String(bible.abbreviation || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (/^NASB/.test(code)) return 'NASB';
  if (/^NRSV/.test(code)) return 'NRSV';
  if (/^KJV/.test(code)) return 'KJV';
  if (/^ESV/.test(code)) return 'ESV';
  return code;
};
export function isEnglishBible(bible) {
  const language = bible.language;
  return language ? language.id === 'eng' || language.iso639_3 === 'eng' || /^English(?:\b|$)/i.test(language.name || '')
    : ENGLISH_CODES.has(family(bible));
}
export function bibleCatalogGroup(bible) {
  if (!isEnglishBible(bible)) return 'Other languages';
  return LEADERS.includes(family(bible)) ? 'Popular English' : 'Other English';
}
export function orderBibleCatalog(catalog) {
  const rank = bible => !isEnglishBible(bible) ? 2 : LEADERS.includes(family(bible)) ? 0 : 1;
  return [...catalog].sort((a, b) => rank(a) - rank(b)
    || (rank(a) === 0 ? LEADERS.indexOf(family(a)) - LEADERS.indexOf(family(b)) : 0)
    || (rank(a) === 2 ? String(a.language?.name || '').localeCompare(String(b.language?.name || ''), 'en') : 0)
    || String(a.name || a.abbreviation || '').localeCompare(String(b.name || b.abbreviation || ''), 'en')
    || String(a.id).localeCompare(String(b.id), 'en'));
}
