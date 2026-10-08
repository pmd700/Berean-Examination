// Step 7C: AI Graph Markdown rendering layer.
//
// Converts the structured Brain retrieval shapes produced by
// brainRetrieval.ts + mcp.ts into compact, graph-preserving markdown
// that is far cheaper for ChatGPT to read than raw JSON, while still
// preserving every piece of information a model needs to cite back:
//
//   • card IDs + titles
//   • source IDs + titles
//   • connection direction (from → to) with relationship/label
//   • web names + tags
//   • per-row plain-text notes/snippets
//   • ordered flow when a chain of next/then/leads-to connections forms
//
// HARD GUARANTEES of this module (defense in depth — none of the
// retrieval helpers actually surface these, but a defensive belt-and-
// braces pass here makes sure nothing leaks even if upstream changes):
//
//   • The hidden BEREAN_KNOWLEDGE_WEB base64 restore block is stripped
//     from every text input before it ever reaches the AI.
//   • Auth0 user IDs (auth0|…, google-oauth2|…, etc.) are redacted.
//   • HTML tags + common entities are stripped (Step 7B already does
//     this for snippets — repeated here for raw text paths).
//   • Empty / null / private fields (enc_payload, user_id, canvas x/y)
//     are never rendered.
//   • Table cells are pipe-escaped and newline-collapsed so a single
//     stray bar/newline can't corrupt the markdown grid.
//
// NOTHING in this file writes to the database. It is pure render.

import { htmlToPlainText, safeParseTags } from "./textUtilities";

// ─── Sanitizers ───────────────────────────────────────────────────────

// Removes the hidden `<!-- BEREAN_KNOWLEDGE_WEB:BEGIN … :END -->`
// restore block (and the "Do not edit below this line…" warning that
// precedes it in our exporter). Used anywhere exported/imported user
// markdown might end up in AI context.
export function stripBereanHiddenRestoreBlock(markdown: string | null | undefined): string {
  if (!markdown) return "";
  let s = String(markdown);
  // Strip the whole BEGIN…END block (any whitespace, multi-line,
  // case-insensitive so mixed-case sentinels can't sneak through).
  s = s.replace(/<!--\s*BEREAN_KNOWLEDGE_WEB\s*:\s*BEGIN[\s\S]*?BEREAN_KNOWLEDGE_WEB\s*:\s*END\s*-->/gi, "");
  // Strip the "Do not edit below this line…" warning comment that
  // sits just above the block in our exporter.
  s = s.replace(/<!--\s*Do not edit below this line[\s\S]*?-->/gi, "");
  // Belt-and-braces: if the BEGIN sentinel survived without its END
  // (truncated paste, etc.), drop from BEGIN to end of input.
  s = s.replace(/<!--\s*BEREAN_KNOWLEDGE_WEB\s*:\s*BEGIN[\s\S]*$/gi, "");
  // Drop any standalone long base64-looking lines that survived
  // (>200 chars of base64 chars on a single line). Defensive only.
  s = s.replace(/^[A-Za-z0-9+/=]{200,}$/gm, "");
  return s.trim();
}

// Redacts Auth0 / OAuth provider user-id strings so they can never
// appear in AI markdown context. Matches the common shapes:
//   auth0|<hex>, google-oauth2|<id>, samlp|<provider>|<id>, etc.
export function redactAuthIds(s: string | null | undefined): string {
  if (!s) return "";
  return String(s).replace(
    /\b(auth0|google-oauth2|samlp|windowslive|github|facebook|twitter|apple|email|oidc|adfs|waad)\|[^\s,;|<>"']+/gi,
    "[redacted-user-id]",
  );
}

// One-shot input cleaner used everywhere text is about to be rendered.
// Order matters: hidden block first (it can contain HTML + ids), then
// HTML strip, then auth-id redact, then whitespace collapse.
export function safeText(input: string | null | undefined, max?: number): string {
  if (input == null) return "";
  let s = stripBereanHiddenRestoreBlock(String(input));
  s = htmlToPlainText(s);
  s = redactAuthIds(s);
  s = s.replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, " ").trim();
  if (max && s.length > max) s = s.slice(0, max - 1).trimEnd() + "…";
  return s;
}

// Escape a value for use inside a markdown table cell. Newlines, pipes
// and stray angle brackets can break the grid; collapse everything to
// a single line and escape pipes.
function cell(input: any, max = 160): string {
  const s = safeText(input == null ? "" : String(input), max);
  return s.replace(/\|/g, "\\|").replace(/\n+/g, " ").trim() || "—";
}

function joinTags(tags: any): string {
  const arr = Array.isArray(tags) ? tags : safeParseTags(tags);
  return arr && arr.length ? arr.map(t => safeText(t, 40)).filter(Boolean).join(", ") : "";
}

// ─── Per-row renderers ────────────────────────────────────────────────

export function renderCardMarkdown(card: any): string {
  if (!card) return "";
  const lines: string[] = [];
  lines.push(`### Card #${card.id}: ${safeText(card.title, 200) || "(untitled)"}`);
  const meta: string[] = [];
  if (card.web_name) meta.push(`Web: ${safeText(card.web_name, 60)}`);
  const tagsStr = joinTags(card.tags);
  if (tagsStr) meta.push(`Tags: ${tagsStr}`);
  if (card.status) meta.push(`Status: ${safeText(card.status, 30)}`);
  if (meta.length) lines.push(meta.join("  ·  "));
  const body = safeText(card.description_plain || card.description || card.description_snippet, 800);
  if (body) {
    lines.push("");
    lines.push(body);
  }
  return lines.join("\n");
}

// ─── Tables ───────────────────────────────────────────────────────────

export function renderCardsTableMarkdown(cards: any[]): string {
  if (!cards || cards.length === 0) return "_(no cards)_";
  const rows: string[] = [];
  rows.push("| ID | Web | Title | Tags | Notes |");
  rows.push("|---|---|---|---|---|");
  for (const c of cards) {
    rows.push(
      `| ${cell(c.id, 12)} | ${cell(c.web_name, 60)} | ${cell(c.title, 120)} | ${cell(joinTags(c.tags), 80)} | ${cell(c.description_snippet || c.description_plain || c.snippet, 240)} |`,
    );
  }
  return rows.join("\n");
}

export function renderConnectionsTableMarkdown(connections: any[]): string {
  if (!connections || connections.length === 0) return "_(no connections)_";
  const rows: string[] = [];
  rows.push("| From | Relationship | To | Evidence |");
  rows.push("|---|---|---|---|");
  for (const co of connections) {
    const fromLabel = co.from_card_title
      ? `#${co.from_card_id} ${co.from_card_title}`
      : co.from_card_id != null ? `#${co.from_card_id}` : "?";
    const toLabel = co.to_card_title
      ? `#${co.to_card_id} ${co.to_card_title}`
      : co.to_card_id != null ? `#${co.to_card_id}` : "?";
    const rel = safeText(co.label, 60) || safeText(co.relationship_type, 40) || "connected";
    rows.push(
      `| ${cell(fromLabel, 120)} | ${cell(rel, 60)} | ${cell(toLabel, 120)} | ${cell(co.evidence_snippet || co.evidence, 200)} |`,
    );
  }
  return rows.join("\n");
}

function renderSourcesTableMarkdown(sources: any[]): string {
  if (!sources || sources.length === 0) return "_(no sources)_";
  const rows: string[] = [];
  rows.push("| ID | Web | Title | Type | Notes |");
  rows.push("|---|---|---|---|---|");
  for (const s of sources) {
    const notes = s.ai_summary || s.raw_text_snippet || s.snippet || "";
    rows.push(
      `| ${cell(s.id, 12)} | ${cell(s.web_name, 60)} | ${cell(s.title, 120)} | ${cell(s.source_type, 40)} | ${cell(notes, 240)} |`,
    );
  }
  return rows.join("\n");
}

// ─── Flow detection ───────────────────────────────────────────────────
// If the connection graph is mostly a linear chain (each card has at
// most one outgoing edge and one incoming edge, no cycles), surface
// an ordered "## Flow" list above the table. This is the format the
// Daily Schedule example uses (Prayer → Adult Nogi → Shower → …).
function detectOrderedFlow(connections: any[]): Array<{ from: any; to: any; rel: string }> | null {
  if (!connections || connections.length < 2) return null;
  const out = new Map<number, any[]>();
  const inDeg = new Map<number, number>();
  const seenEdges = new Set<string>();
  for (const co of connections) {
    if (co.from_card_id == null || co.to_card_id == null) return null;
    const key = `${co.from_card_id}->${co.to_card_id}`;
    if (seenEdges.has(key)) return null;
    seenEdges.add(key);
    if (!out.has(co.from_card_id)) out.set(co.from_card_id, []);
    out.get(co.from_card_id)!.push(co);
    inDeg.set(co.to_card_id, (inDeg.get(co.to_card_id) || 0) + 1);
    if (out.get(co.from_card_id)!.length > 1) return null; // branching
    if ((inDeg.get(co.to_card_id) || 0) > 1) return null;  // merging
  }
  // Find a single starting node (has outgoing but no incoming).
  const starts: number[] = [];
  for (const fromId of out.keys()) {
    if (!inDeg.has(fromId)) starts.push(fromId);
  }
  if (starts.length !== 1) return null;
  const chain: Array<{ from: any; to: any; rel: string }> = [];
  let cur: number | undefined = starts[0];
  const guard = new Set<number>();
  while (cur != null && out.has(cur)) {
    if (guard.has(cur)) return null;
    guard.add(cur);
    const co = out.get(cur)![0];
    chain.push({
      from: { id: co.from_card_id, title: co.from_card_title },
      to: { id: co.to_card_id, title: co.to_card_title },
      rel: safeText(co.label, 60) || safeText(co.relationship_type, 40) || "next",
    });
    cur = co.to_card_id;
  }
  if (chain.length !== connections.length) return null;
  return chain;
}

function renderFlowMarkdown(chain: Array<{ from: any; to: any; rel: string }>): string {
  const steps: string[] = [];
  if (chain.length === 0) return "";
  steps.push(`1. #${chain[0].from.id} ${safeText(chain[0].from.title, 100) || "(untitled)"}`);
  for (let i = 0; i < chain.length; i++) {
    const c = chain[i];
    steps.push(`${i + 2}. _${c.rel}_ → #${c.to.id} ${safeText(c.to.title, 100) || "(untitled)"}`);
  }
  return steps.join("\n");
}

// ─── Top-level renderers ──────────────────────────────────────────────

export interface SearchResultsForMarkdown {
  query: string;
  scope: string;
  total: number;
  results: any[]; // mixed result_type rows from mcp.ts
}

export function renderSearchResultsMarkdownForAI(input: SearchResultsForMarkdown): string {
  const q = safeText(input.query, 200);
  const lines: string[] = [];
  lines.push(`# Search: ${q || "(empty query)"}`);
  lines.push(`Scope: \`${input.scope}\`  ·  Results: ${input.total}`);

  const cards = input.results.filter(r => r.result_type === "card");
  const sources = input.results.filter(r => r.result_type === "source");
  const connections = input.results.filter(r => r.result_type === "connection");

  if (cards.length > 0) {
    lines.push("");
    lines.push(`## Cards (${cards.length})`);
    lines.push(renderCardsTableMarkdown(cards.map(c => ({
      ...c,
      description_snippet: c.snippet,
    }))));
  }
  if (sources.length > 0) {
    lines.push("");
    lines.push(`## Sources (${sources.length})`);
    lines.push(renderSourcesTableMarkdown(sources.map(s => ({
      ...s,
      raw_text_snippet: s.snippet,
    }))));
  }
  if (connections.length > 0) {
    lines.push("");
    lines.push(`## Connections (${connections.length})`);
    lines.push(renderConnectionsTableMarkdown(connections.map(co => ({
      ...co,
      evidence_snippet: co.evidence_snippet || co.snippet,
    }))));
  }

  if (cards.length === 0 && sources.length === 0 && connections.length === 0) {
    lines.push("");
    lines.push("_No results matched._");
  }

  return lines.join("\n");
}

export interface ContextPackForMarkdown {
  query: string;
  sources: any[];
  cards: any[];
  connections: any[];
  notes: string[];
  // Step 7D additions — optional, only present when section/web mode ran.
  matched_section?: {
    id: number;
    web_id: number;
    web_name?: string | null;
    title: string;
    card_count?: number;
  } | null;
  matched_web?: {
    id: number;
    web_name?: string | null;
    card_count?: number;
  } | null;
  retrieval_mode?: string;
  positional_order?: Array<{ id: number; title: string }>;
}

export function renderContextPackMarkdownForAI(pack: ContextPackForMarkdown): string {
  const lines: string[] = [];
  const q = safeText(pack.query, 200);
  lines.push(`# Brain Context Pack${q ? `: ${q}` : ""}`);

  // Step 7D: surface which retrieval mode answered the query, and the
  // matched section/web up top so the AI can cite "section: X" cleanly.
  if (pack.matched_section) {
    const ms = pack.matched_section;
    lines.push("");
    lines.push("## Matched Section");
    if (ms.web_name) lines.push(`- Web: ${safeText(ms.web_name, 80)}`);
    lines.push(`- Section: ${safeText(ms.title, 200) || "(untitled)"}`);
    if (typeof ms.card_count === "number") {
      lines.push(`- Cards in section: ${ms.card_count}`);
    }
  } else if (pack.matched_web) {
    const mw = pack.matched_web;
    lines.push("");
    lines.push("## Matched Web");
    lines.push(`- Web: ${safeText(mw.web_name, 80) || `#${mw.id}`}`);
    if (typeof mw.card_count === "number") {
      lines.push(`- Cards in web: ${mw.card_count}`);
    }
  }

  // Group cards by web for cleaner reading when multiple webs are involved.
  const byWeb = new Map<string, any[]>();
  for (const c of pack.cards) {
    const key = c.web_name || `web #${c.web_id ?? "?"}`;
    if (!byWeb.has(key)) byWeb.set(key, []);
    byWeb.get(key)!.push(c);
  }

  if (pack.sources.length > 0) {
    lines.push("");
    lines.push(`## Sources (${pack.sources.length})`);
    lines.push(renderSourcesTableMarkdown(pack.sources));
  }

  if (pack.cards.length > 0) {
    lines.push("");
    if (byWeb.size > 1) {
      lines.push(`## Cards (${pack.cards.length})`);
      for (const [webName, ws] of byWeb) {
        lines.push("");
        lines.push(`### Web: ${safeText(webName, 80)}`);
        lines.push(renderCardsTableMarkdown(ws));
      }
    } else {
      const onlyWeb = Array.from(byWeb.keys())[0];
      lines.push(`## Cards (${pack.cards.length})${onlyWeb ? ` — Web: ${safeText(onlyWeb, 80)}` : ""}`);
      lines.push(renderCardsTableMarkdown(pack.cards));
    }
  }

  let flowRendered = false;
  if (pack.connections.length > 0) {
    const flow = detectOrderedFlow(pack.connections);
    if (flow) {
      lines.push("");
      lines.push(`## Flow (${flow.length} step${flow.length === 1 ? "" : "s"})`);
      lines.push(renderFlowMarkdown(flow));
      flowRendered = true;
    }
    lines.push("");
    lines.push(`## Connections (${pack.connections.length})`);
    lines.push(renderConnectionsTableMarkdown(pack.connections));
  }

  // Step 7D: when section/web mode loaded cards but the connection
  // graph isn't a strict chain (branching, missing edges, etc.), fall
  // back to canvas-position ordering (top-to-bottom, left-to-right) so
  // the AI still gets a visually-faithful sequence.
  if (
    !flowRendered &&
    Array.isArray(pack.positional_order) &&
    pack.positional_order.length > 1
  ) {
    lines.push("");
    lines.push(`## Positional Order (${pack.positional_order.length})`);
    lines.push("_Top-to-bottom, then left-to-right by canvas position. Used when connections do not form a strict linear chain._");
    pack.positional_order.forEach((p, i) => {
      lines.push(`${i + 1}. #${p.id} ${safeText(p.title, 120) || "(untitled)"}`);
    });
  }

  if (pack.notes && pack.notes.length > 0) {
    lines.push("");
    lines.push("## Notes");
    for (const n of pack.notes) lines.push(`- ${safeText(n, 200)}`);
  }

  if (
    pack.sources.length === 0 &&
    pack.cards.length === 0 &&
    pack.connections.length === 0 &&
    (!pack.notes || pack.notes.length === 0)
  ) {
    lines.push("");
    lines.push("_Context pack is empty._");
  }

  return lines.join("\n");
}

export function renderCardContextMarkdownForAI(ctx: any): string {
  if (!ctx || !ctx.card) return "_(card not found)_";
  const lines: string[] = [];
  const c = ctx.card;
  lines.push(`# Card #${c.id}: ${safeText(c.title, 200) || "(untitled)"}`);
  const meta: string[] = [];
  if (c.web_name) meta.push(`Web: ${safeText(c.web_name, 60)}`);
  const tagsStr = joinTags(c.tags);
  if (tagsStr) meta.push(`Tags: ${tagsStr}`);
  if (c.status) meta.push(`Status: ${safeText(c.status, 30)}`);
  if (meta.length) lines.push(meta.join("  ·  "));

  const body = safeText(c.description_plain || c.description, 1200);
  if (body) {
    lines.push("");
    lines.push("## Description");
    lines.push(body);
  }

  if (Array.isArray(ctx.connections) && ctx.connections.length > 0) {
    lines.push("");
    lines.push(`## Connections (${ctx.connections.length})`);
    lines.push(renderConnectionsTableMarkdown(ctx.connections));
  }

  if (Array.isArray(ctx.neighbors) && ctx.neighbors.length > 0) {
    lines.push("");
    lines.push(`## Neighbor Cards (${ctx.neighbors.length})`);
    lines.push(renderCardsTableMarkdown(ctx.neighbors));
  }

  if (Array.isArray(ctx.linked_sources) && ctx.linked_sources.length > 0) {
    lines.push("");
    lines.push(`## Linked Sources (${ctx.linked_sources.length})`);
    lines.push(renderSourcesTableMarkdown(ctx.linked_sources.map((s: any) => ({
      ...s,
      ai_summary: s?.metadata_json?.ai_processing_v1?.summary ?? s.ai_summary,
    }))));
  }

  return lines.join("\n");
}

export function renderSourceContextMarkdownForAI(ctx: any, include_raw = false): string {
  if (!ctx || !ctx.source) return "_(source not found)_";
  const s = ctx.source;
  const lines: string[] = [];
  lines.push(`# Source #${s.id}: ${safeText(s.title, 200) || "(untitled)"}`);
  const meta: string[] = [];
  if (s.web_name) meta.push(`Web: ${safeText(s.web_name, 60)}`);
  if (s.source_type) meta.push(`Type: ${safeText(s.source_type, 40)}`);
  if (s.processing_status) meta.push(`Status: ${safeText(s.processing_status, 30)}`);
  if (typeof s.raw_text_chars === "number") meta.push(`Length: ${s.raw_text_chars} chars`);
  if (s.source_url) meta.push(`URL: ${safeText(s.source_url, 120)}`);
  if (meta.length) lines.push(meta.join("  ·  "));

  const ai = ctx.ai_processing;
  if (ai?.summary) {
    lines.push("");
    lines.push("## AI Summary");
    lines.push(safeText(ai.summary, 1500));
  }
  for (const [field, label] of [
    ["key_points", "Key Points"],
    ["source_claims", "Claims"],
    ["concepts", "Concepts"],
    ["questions_raised", "Questions Raised"],
  ] as const) {
    const arr = ai?.[field];
    if (Array.isArray(arr) && arr.length > 0) {
      lines.push("");
      lines.push(`### ${label}`);
      for (const item of arr) {
        if (typeof item === "string") lines.push(`- ${safeText(item, 300)}`);
      }
    }
  }
  if (ai?.theology && typeof ai.theology === "object") {
    const t = ai.theology;
    const entries = Object.entries(t).filter(([, v]) => v != null && v !== "");
    if (entries.length > 0) {
      lines.push("");
      lines.push("### Theology");
      for (const [k, v] of entries) {
        lines.push(`- **${safeText(k, 40)}**: ${safeText(typeof v === "string" ? v : JSON.stringify(v), 300)}`);
      }
    }
  }
  if (ctx.ai_processing_error) {
    lines.push("");
    lines.push("## AI Processing Error");
    lines.push(safeText(
      typeof ctx.ai_processing_error === "string"
        ? ctx.ai_processing_error
        : JSON.stringify(ctx.ai_processing_error),
      400,
    ));
  }

  if (Array.isArray(ctx.linked_cards) && ctx.linked_cards.length > 0) {
    lines.push("");
    lines.push(`## Citing Cards (${ctx.linked_cards.length})`);
    lines.push(renderCardsTableMarkdown(ctx.linked_cards));
  }

  if (include_raw && typeof s.raw_text === "string" && s.raw_text.length > 0) {
    lines.push("");
    lines.push("## Raw Text");
    lines.push(safeText(s.raw_text, 8000));
  } else if (typeof s.raw_text_chars === "number" && s.raw_text_chars > 0) {
    lines.push("");
    lines.push(`_Raw text omitted (${s.raw_text_chars} chars). Pass include_raw=true to fetch._`);
  }

  return lines.join("\n");
}

// ─── Compact structured sidecar (for format="json" / "both") ──────────
// Strips Auth0 user ids, enc_payload, canvas geometry, raw HTML, etc.
// so even the JSON channel is safe to forward to an AI client.
export function compactSearchResults(input: SearchResultsForMarkdown) {
  return {
    query: safeText(input.query, 400),
    scope: safeText(input.scope, 40),
    total: input.total,
    results: input.results.map(r => compactResultRow(r)),
  };
}

export function compactContextPack(pack: ContextPackForMarkdown) {
  const out: any = {
    query: safeText(pack.query, 400),
    sources: pack.sources.map(compactSource),
    cards: pack.cards.map(compactCard),
    connections: pack.connections.map(compactConnection),
    // Notes are server-built strings but may interpolate DB-derived
    // section titles ("…full contents of section \"X\"…"). Route every
    // note through safeText so the JSON sidecar can never leak Auth0
    // ids, raw HTML, or the BEREAN_KNOWLEDGE_WEB restore block even
    // if a title happens to contain those substrings.
    notes: (pack.notes || []).map((n) => safeText(n, 400)).filter(Boolean),
  };
  // Step 7D — surface retrieval mode + matched section/web in the JSON
  // sidecar so AI clients can branch on it. Geometry (x/y/width/height)
  // is intentionally omitted; only id/web_id/web_name/title/card_count.
  if (pack.retrieval_mode) out.retrieval_mode = pack.retrieval_mode;
  if (pack.matched_section) {
    out.matched_section = {
      id: pack.matched_section.id,
      web_id: pack.matched_section.web_id,
      web_name: safeText(pack.matched_section.web_name, 80) || null,
      title: safeText(pack.matched_section.title, 200) || null,
      card_count: pack.matched_section.card_count,
    };
  }
  if (pack.matched_web) {
    out.matched_web = {
      id: pack.matched_web.id,
      web_name: safeText(pack.matched_web.web_name, 80) || null,
      card_count: pack.matched_web.card_count,
    };
  }
  if (Array.isArray(pack.positional_order) && pack.positional_order.length > 0) {
    out.positional_order = pack.positional_order.map((p) => ({
      id: p.id,
      title: safeText(p.title, 200) || null,
    }));
  }
  return out;
}

export function compactCardContext(ctx: any) {
  if (!ctx?.card) return null;
  return {
    card: compactCard(ctx.card),
    connections: (ctx.connections || []).map(compactConnection),
    neighbors: (ctx.neighbors || []).map(compactCard),
    linked_sources: (ctx.linked_sources || []).map(compactSource),
  };
}

export function compactSourceContext(ctx: any, include_raw = false) {
  if (!ctx?.source) return null;
  const s = ctx.source;
  return {
    source: {
      ...compactSource(s),
      ...(include_raw && typeof s.raw_text === "string"
        ? { raw_text: safeText(s.raw_text, 12000) }
        : {}),
    },
    ai_processing: ctx.ai_processing
      ? {
          summary: ctx.ai_processing.summary || null,
          key_points: ctx.ai_processing.key_points || null,
          source_claims: ctx.ai_processing.source_claims || null,
          concepts: ctx.ai_processing.concepts || null,
          questions_raised: ctx.ai_processing.questions_raised || null,
          theology: ctx.ai_processing.theology || null,
          confidence: ctx.ai_processing.confidence ?? null,
        }
      : null,
    ai_processing_error: ctx.ai_processing_error || null,
    linked_cards: (ctx.linked_cards || []).map(compactCard),
  };
}

function compactResultRow(r: any) {
  if (r.result_type === "card") return { type: "card", ...compactCard(r) };
  if (r.result_type === "source") return { type: "source", ...compactSource(r) };
  if (r.result_type === "connection") return { type: "connection", ...compactConnection(r) };
  return { type: r.result_type || "unknown", id: r.id, title: r.title };
}

// All string fields are routed through safeText (which strips the
// hidden restore block, strips HTML, and redacts Auth0/OAuth provider
// user ids) so even the JSON sidecar can never leak those values.
function compactCard(c: any) {
  if (!c) return null;
  const tagsRaw = Array.isArray(c.tags) ? c.tags : safeParseTags(c.tags);
  return {
    id: c.id,
    web_id: c.web_id,
    web_name: safeText(c.web_name, 80) || null,
    title: safeText(c.title, 300) || null,
    tags: tagsRaw.map((t: any) => safeText(t, 60)).filter(Boolean),
    status: safeText(c.status, 30) || null,
    description: safeText(c.description_plain || c.description_snippet || c.description || c.snippet, 600) || null,
  };
}

function compactSource(s: any) {
  if (!s) return null;
  return {
    id: s.id,
    web_id: s.web_id,
    web_name: safeText(s.web_name, 80) || null,
    title: safeText(s.title, 300) || null,
    source_type: safeText(s.source_type, 40) || null,
    processing_status: safeText(s.processing_status, 30) || null,
    source_url: safeText(s.source_url, 400) || null,
    ai_summary: safeText(s.ai_summary || s?.metadata_json?.ai_processing_v1?.summary, 800) || null,
    snippet: safeText(s.raw_text_snippet || s.snippet, 400) || null,
  };
}

function compactConnection(co: any) {
  if (!co) return null;
  const out: any = {
    id: co.id,
    web_id: co.web_id,
    web_name: safeText(co.web_name, 80) || null,
    from: { id: co.from_card_id, title: safeText(co.from_card_title, 200) || null },
    to: { id: co.to_card_id, title: safeText(co.to_card_title, 200) || null },
    relationship: safeText(co.label, 80) || safeText(co.relationship_type, 60) || null,
    evidence: safeText(co.evidence_snippet || co.evidence, 400) || null,
  };
  // Step 7D.2 — flag section-internal edges whose label/relationship/
  // evidence were empty on disk but were preserved as "next" flow
  // edges because they sit inside a matched canvas section.
  if (co.inferred_from_section_connection) {
    out.inferred_from_section_connection = true;
  }
  return out;
}
