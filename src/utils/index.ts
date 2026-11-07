export function createPageUrl(pageName: string) {
    return '/' + pageName.replace(/ /g, '-');
}

// ── Deep-link helpers ────────────────────────────────────────────────
// The local SQLite record id is the source of truth for a Knowledge Web or
// a standalone Mind Note. The slug is cosmetic only (titles change and
// duplicate), so URLs take the form `/knowledge-webs/<slug>-<id>` and
// `/notes/<slug>-<id>`, and we always parse the trailing numeric id back
// out. A bare `/knowledge-webs/<id>` (no slug) is equally valid.

export function slugify(title?: string | null): string {
    return String(title || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60);
}

export function webDeepLink(id: number | string, title?: string | null): string {
    const slug = slugify(title);
    return slug ? `/knowledge-webs/${slug}-${id}` : `/knowledge-webs/${id}`;
}

export function noteDeepLink(id: number | string, title?: string | null): string {
    const slug = slugify(title);
    return slug ? `/notes/${slug}-${id}` : `/notes/${id}`;
}

export function timegraphDeepLink(id: number | string, title?: string | null): string {
    const slug = slugify(title);
    return slug ? `/timegraphs/${slug}-${id}` : `/timegraphs/${id}`;
}

export function spreadsheetDeepLink(id: number | string, title?: string | null, target?: { sheet?: string; cell?: string }): string {
    const slug = slugify(title);
    const base = slug ? `/spreadsheets/${slug}-${id}` : `/spreadsheets/${id}`;
    const params = new URLSearchParams();
    if (target?.sheet) params.set('sheet', target.sheet);
    if (target?.cell) params.set('cell', target.cell);
    return base + (params.size ? `?${params}` : '');
}

// Extracts the trailing numeric id from a route param, accepting both the
// pretty form ("my-web-title-123") and the bare id ("123"). Returns null
// when no numeric id can be found.
export function parseIdFromParam(raw?: string | null): number | null {
    if (raw == null) return null;
    const m = String(raw).match(/(\d+)\s*$/);
    return m ? Number(m[1]) : null;
}
