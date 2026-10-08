import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildChapterInsightsContract,
  buildUrlImportContract,
  buildUrlMetadataContract,
} from '../src/ai-spine/providers/legacyPromptContracts.js';

test('chapter insights contract stays inert and structured', () => {
  const contract = buildChapterInsightsContract({
    book: 'Averon',
    chapter: 4,
    chapterText: 'Entirely invented chapter text.',
  });
  assert.match(contract.prompt, /Averon 4/);
  assert.match(contract.prompt, /Entirely invented chapter text/);
  assert.equal(contract.requiresInternetContext, false);
  assert.deepEqual(contract.responseSchema.required, ['summary', 'context', 'questions']);
});

test('URL metadata contract marks external context explicitly', () => {
  const contract = buildUrlMetadataContract('https://example.invalid/invented');
  assert.match(contract.prompt, /https:\/\/example\.invalid\/invented/);
  assert.equal(contract.requiresInternetContext, true);
  assert.deepEqual(contract.responseSchema.required, ['title']);
});

test('URL import contract remains a prompt only', () => {
  const contract = buildUrlImportContract('https://example.invalid/invented');
  assert.match(contract.prompt, /Format as markdown/);
  assert.equal(contract.requiresInternetContext, true);
  assert.equal(contract.responseSchema, null);
});
