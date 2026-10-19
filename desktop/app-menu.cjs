'use strict';

/**
 * The macOS application menu.
 *
 * BEX had no menu of its own, so Electron installed its default one — and that
 * default binds Cmd+H to Hide Application. The OS takes that keystroke before
 * the page ever sees it, which makes Cmd+H unusable as an editor shortcut.
 *
 * This template exists to free exactly one key. Hide is still on the menu and
 * still works from it; it simply no longer carries the accelerator. Everything
 * else is the standard set of roles, present for a reason: replacing the
 * default menu without them is how an Electron app loses Cmd+C, Cmd+V and
 * Cmd+Z, because on macOS those shortcuts are delivered BY the menu.
 */

const EDIT_ROLES = Object.freeze([
  'undo', 'redo', 'cut', 'copy', 'paste', 'pasteAndMatchStyle', 'delete', 'selectAll',
]);

function buildTemplate(app) {
  const name = app.name;

  return [
    {
      label: name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        // Deliberately NOT `role: 'hide'`: the role carries Cmd+H with it, and
        // that key belongs to the editor's highlight menu.
        { label: `Hide ${name}`, accelerator: '', click: () => app.hide() },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        ...EDIT_ROLES.map((role) => ({ role })),
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      role: 'windowMenu',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { role: 'front' },
      ],
    },
  ];
}

/**
 * Only macOS needs this. Everywhere else Cmd/Ctrl+H is nobody's shortcut, and
 * the default menu is left exactly as it was.
 */
function installApplicationMenu({ app, Menu, platform = process.platform }) {
  if (platform !== 'darwin') return null;
  const menu = Menu.buildFromTemplate(buildTemplate(app));
  Menu.setApplicationMenu(menu);
  return menu;
}

module.exports = { EDIT_ROLES, buildTemplate, installApplicationMenu };
