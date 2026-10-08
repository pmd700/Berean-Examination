import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const source = fs.readFileSync(
  path.join(root, 'src/components/editor/RichTextEditor.jsx'),
  'utf8',
);

describe('link editor interaction contract', () => {
  it('has exactly one owner for opening a clicked hyperlink', () => {
    const linkExtension = source.slice(
      source.indexOf('Link.configure({'),
      source.indexOf('CollapsibleToggle.configure'),
    );
    assert.match(linkExtension, /openOnClick:\s*false/);
    assert.match(source, /window\.open\(link\.href, '_blank', 'noopener,noreferrer'\)/);
  });

  it('anchors the edit panel instead of centering it in the viewport', () => {
    const panel = source.slice(
      source.indexOf('{showLinkInput && ReactDOM.createPortal'),
      source.indexOf('{showKeywordPicker && ReactDOM.createPortal'),
    );
    assert.match(panel, /style=\{\{ left: linkPanelPosition\.left, top: linkPanelPosition\.top \}\}/);
    assert.doesNotMatch(panel, /left-1\/2|top-1\/2|-translate-x-1\/2|-translate-y-1\/2/);
  });

  it('does not render decorative traffic-light controls', () => {
    const panel = source.slice(
      source.indexOf('{showLinkInput && ReactDOM.createPortal'),
      source.indexOf('{showKeywordPicker && ReactDOM.createPortal'),
    );
    assert.doesNotMatch(panel, /#FF5F57|#FEBC2E|#28C840|button-close-link-input/);
    assert.match(panel, /button-set-link/);
    assert.match(panel, /button-remove-link/);
  });

  it('offers separate controls for the visible label and destination URL', () => {
    const panel = source.slice(
      source.indexOf('{showLinkInput && ReactDOM.createPortal'),
      source.indexOf('{showKeywordPicker && ReactDOM.createPortal'),
    );
    assert.match(panel, /Display text/);
    assert.match(panel, /data-testid="input-link-text"/);
    assert.match(panel, /Destination URL/);
    assert.match(panel, /data-testid="input-link-url"/);
  });
});
