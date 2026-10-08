function asUrl(value) {
  if (!value) return null;
  try {
    return new URL(value, 'https://bex.local');
  } catch {
    return null;
  }
}

function trailingRecordId(value) {
  const match = String(value || '').match(/(\d+)\s*$/);
  return match ? match[1] : null;
}

/**
 * The stable saved-item identity represented by a URL. Slugs are cosmetic and
 * may change after a rename, so notes, webs and timelines compare by table + id.
 * Legacy KnowledgeWeb query links are included for old stored activities.
 */
function savedItemIdentity(url) {
  const deepLink = url.pathname.match(/^\/(notes|knowledge-webs|timegraphs)\/([^/]+)\/?$/);
  if (deepLink) {
    const id = trailingRecordId(deepLink[2]);
    return id ? `${deepLink[1]}:${id}` : null;
  }

  if (url.pathname === '/KnowledgeWeb') {
    const noteId = trailingRecordId(url.searchParams.get('note'));
    if (noteId) return `notes:${noteId}`;
    const webId = trailingRecordId(url.searchParams.get('web'));
    if (webId) return `knowledge-webs:${webId}`;
  }

  return null;
}

/** True when a resume target is already the page represented by a workspace. */
export function sameResumeDestination(targetPath, currentPath) {
  const target = asUrl(targetPath);
  const current = asUrl(currentPath);
  if (!target || !current) return false;

  const targetItem = savedItemIdentity(target);
  const currentItem = savedItemIdentity(current);
  if (targetItem || currentItem) return targetItem !== null && targetItem === currentItem;

  const targetPathname = target.pathname.replace(/\/$/, '') || '/';
  const currentPathname = current.pathname.replace(/\/$/, '') || '/';
  if (targetPathname !== currentPathname) return false;

  // Extra transient state on the current page does not make it a different
  // destination, but every identifying parameter in the resume target must be
  // present and equal (for example Study?chapter_id=12).
  for (const [key, value] of target.searchParams) {
    if (current.searchParams.get(key) !== value) return false;
  }
  return true;
}

