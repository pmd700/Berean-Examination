'use strict';

// API:* is the durable annotation locator introduced by remote Scripture reads.
// Downloaded/imported chapters have their own translation locator and stay intact.
function isApiStudyRecord(record) {
  return typeof record?.version === 'string' && record.version.startsWith('API:');
}

function separateApiStudyRecord(record) {
  if (!isApiStudyRecord(record)) return record;
  const result = { ...record, scripture_source: 'api', raw_text: '' };
  for (const field of ['blocks', 'verses_json', 'rich_verses', 'scripture_content', 'api_response']) delete result[field];
  if (!result.api_bible_id) result.api_bible_id = record.version.slice(4);
  return result;
}

module.exports = { isApiStudyRecord, separateApiStudyRecord };
