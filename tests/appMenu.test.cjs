'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EDIT_ROLES, buildTemplate, installApplicationMenu } = require('../desktop/app-menu.cjs');

/**
 * The application menu exists to free one keystroke — and replacing Electron's
 * default menu is the classic way to lose Cmd+C, Cmd+V and Cmd+Z without
 * noticing, because on macOS those shortcuts are delivered BY the menu. So the
 * Edit roles are asserted here as loudly as the thing this was written for.
 */

const app = { name: 'Berean Examination', hide() { this.hidden = true; } };

function findItem(template, menuLabel, predicate) {
  const menu = template.find((entry) => entry.label === menuLabel);
  return menu?.submenu.find(predicate) || null;
}

test('Cmd+H is left free for the editor', () => {
  const template = buildTemplate(app);
  const hide = findItem(template, app.name, (item) => /^Hide /.test(item.label || ''));

  assert.ok(hide, 'Hide disappeared from the menu entirely');
  // The `hide` ROLE carries Cmd+H with it, which is the whole problem.
  assert.equal(hide.role, undefined);
  assert.equal(hide.accelerator, '');
});

test('Hide still works from the menu, it just has no shortcut', () => {
  const template = buildTemplate(app);
  const target = { name: 'BEX', hidden: false, hide() { this.hidden = true; } };
  const hide = buildTemplate(target)[0].submenu.find((item) => /^Hide /.test(item.label || ''));

  hide.click();
  assert.equal(target.hidden, true);
});

test('every Edit role survives, or the app loses copy and paste', () => {
  const template = buildTemplate(app);
  const edit = template.find((entry) => entry.label === 'Edit');
  const roles = edit.submenu.map((item) => item.role);

  EDIT_ROLES.forEach((role) => {
    assert.ok(roles.includes(role), `Edit menu lost ${role}`);
  });
  ['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll'].forEach((role) => {
    assert.ok(roles.includes(role), `Edit menu lost ${role}`);
  });
});

test('Hide Others keeps its own shortcut, which is a different combination', () => {
  const template = buildTemplate(app);
  const roles = template[0].submenu.map((item) => item.role);
  assert.ok(roles.includes('hideOthers'));
  assert.ok(roles.includes('unhide'));
  assert.ok(roles.includes('quit'));
});

test('is installed only on macOS, the only platform with the conflict', () => {
  const calls = [];
  const Menu = {
    buildFromTemplate: (template) => ({ template }),
    setApplicationMenu: (menu) => calls.push(menu),
  };

  assert.equal(installApplicationMenu({ app, Menu, platform: 'win32' }), null);
  assert.equal(installApplicationMenu({ app, Menu, platform: 'linux' }), null);
  assert.equal(calls.length, 0, 'replaced the default menu where nothing needed fixing');

  const menu = installApplicationMenu({ app, Menu, platform: 'darwin' });
  assert.ok(menu);
  assert.equal(calls.length, 1);
});
