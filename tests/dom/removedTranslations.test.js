import { expect, it } from 'vitest';
import { isRemovedTranslation, getRemovedTranslationMessage, isTranslationRemovedFromPlan, NASB1995_API_BIBLE_ID } from '@shared/removedTranslations';

it('restores NASB 1995 only from its API edition, retaining the retired local-source checks', () => {
  expect(isRemovedTranslation('NASB1995', { scripture_source: 'api', api_bible_id: NASB1995_API_BIBLE_ID })).toBe(false);
  expect(isRemovedTranslation('NASB1995', { storage_version: `API:${NASB1995_API_BIBLE_ID}`, api_bible_id: NASB1995_API_BIBLE_ID })).toBe(false);
  expect(isRemovedTranslation('NASB1995')).toBe(true);
  expect(isRemovedTranslation('NASB1995', { api_bible_id: NASB1995_API_BIBLE_ID })).toBe(true);
  expect(isRemovedTranslation('NASB1995', { scripture_source: 'api', api_bible_id: 'a761ca71e0b3ddcf-01' })).toBe(true);
  expect(isRemovedTranslation('NASB2020')).toBe(true);
  expect(isRemovedTranslation('NLT')).toBe(true);
  expect(isRemovedTranslation('BSB')).toBe(false);
  expect(isTranslationRemovedFromPlan('NLT')).toBe(true);
  expect(getRemovedTranslationMessage('NLT')).toBe('Temporarily removed from plan.');
  expect(getRemovedTranslationMessage('NASB2020')).toContain('legal compliance');
});
