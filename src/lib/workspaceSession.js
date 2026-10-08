/**
 * The shape rule for a stored workspace session.
 *
 * Kept in a plain module with no aliased imports so it can be tested directly —
 * the same arrangement as tabTitle.js. This is the guard that decides whether a
 * session read back from storage is worth adopting, and adopting a malformed or
 * empty one would replace the user's open tabs with nothing.
 */

/** Retire only the old picker; saved chapter and history URLs stay valid. */
export function normalizeWorkspacePath(value) {
  const [pathname, query = ''] = String(value || '').split('?');
  if (pathname === '/Study' && new URLSearchParams(query).get('new') === '1'
    && !new URLSearchParams(query).get('chapter_id')) return '/LibraryHome';
  return value;
}

/** Coerce anything session-shaped into a usable session, or null. */
export function normalizeSession(parsed) {
  const tabs = Array.isArray(parsed?.tabs)
    ? parsed.tabs.filter((tab) => tab && typeof tab.path === 'string' && typeof tab.id === 'string')
      .map((tab) => normalizeWorkspacePath(tab.path) === tab.path ? tab
        : { ...tab, kind: 'home', path: '/LibraryHome', title: 'New tab' })
    : [];
  if (!tabs.length) return null;
  const activeId = tabs.some((tab) => tab.id === parsed.activeId) ? parsed.activeId : tabs[0].id;
  return { tabs, activeId };
}

export default normalizeSession;
