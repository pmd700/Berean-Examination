import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { sameResumeDestination } from '../src/components/resume/resumeActivityModel.js';

describe('resume activity destination matching', () => {
  it('recognizes the same note by stable id even when its slug changed', () => {
    assert.equal(
      sameResumeDestination('/notes/old-title-27', '/notes/renamed-title-27'),
      true,
    );
  });

  it('does not confuse two different notes', () => {
    assert.equal(sameResumeDestination('/notes/note-27', '/notes/note-28'), false);
  });

  it('recognizes an old query link and its current deep-link page', () => {
    assert.equal(
      sameResumeDestination('/KnowledgeWeb?note=27', '/notes/current-title-27'),
      true,
    );
  });

  it('treats a web as the same page even when transient card state differs', () => {
    assert.equal(
      sameResumeDestination('/knowledge-webs/research-9?web=9&card=4', '/knowledge-webs/research-9'),
      true,
    );
  });

  it('requires identifying query parameters on ordinary pages', () => {
    assert.equal(sameResumeDestination('/Study?chapter_id=12', '/Study?chapter_id=12&verse=4'), true);
    assert.equal(sameResumeDestination('/Study?chapter_id=12', '/Study'), false);
  });
});

