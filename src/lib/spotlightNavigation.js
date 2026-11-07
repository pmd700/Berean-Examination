function asUrl(path) {
  return new URL(path || '/', 'https://bex.local');
}

/** Add the one-use jump instructions without disturbing an existing card id. */
export function buildSpotlightPath(result, rawQuery, nonce = Date.now()) {
  const url = asUrl(result?.href);
  const query = String(result?.matchText || rawQuery || '').trim().slice(0, 500);
  url.searchParams.set('spotlight', query);
  url.searchParams.set('spotlightField', result?.matchField || 'body');
  url.searchParams.set('spotlightJump', String(nonce));
  if (Number.isInteger(result?.matchPage) && result.matchPage >= 0) {
    url.searchParams.set('spotlightPage', String(result.matchPage));
  }
  if (result?.type === 'Timeline Event' && result?.targetId != null) {
    url.searchParams.set('event', String(result.targetId));
  }
  return `${url.pathname}${url.search}`;
}

/**
 * Remove a completed Spotlight jump from a workspace path.
 *
 * These parameters are an instruction, not durable navigation state. Keeping
 * them in an open tab makes a later render replay the old jump. Callers can
 * also name target parameters (for example `card`) that only existed to land
 * the one-time search result.
 */
export function clearSpotlightPath(path, targetParams = []) {
  const url = asUrl(path);
  ['spotlight', 'spotlightField', 'spotlightJump', 'spotlightPage', ...targetParams]
    .forEach((name) => url.searchParams.delete(name));
  const query = url.searchParams.toString();
  return `${url.pathname}${query ? `?${query}` : ''}`;
}

/**
 * Two Spotlight hits in the same saved item belong in the same workspace tab.
 * The query itself is deliberately ignored; selecting a second hit updates the
 * open tab instead of multiplying tabs.
 */
export function spotlightWorkspaceKey(path) {
  const url = asUrl(path);
  const deepLink = url.pathname.match(/^\/(knowledge-webs|notes|timegraphs|spreadsheets)\/(.+)$/);
  if (deepLink) {
    const id = deepLink[2].match(/(\d+)\s*$/)?.[1] || deepLink[2];
    return `/${deepLink[1]}/${id}`;
  }
  if (url.pathname === '/Study') return `/Study:${url.searchParams.get('chapter_id') || ''}`;
  if (url.pathname === '/Keywords') return `/Keywords:${url.searchParams.get('keyword_id') || ''}`;
  return url.pathname;
}

export function sameSpotlightWorkspace(leftPath, rightPath) {
  return spotlightWorkspaceKey(leftPath) === spotlightWorkspaceKey(rightPath);
}
