// Dormant server-side AI wrapper preserved for a future optional Online Mode
// pipeline (Step 3). Intentionally narrow: one function, one model call,
// one JSON output shape. No streaming, no tool-use, no embeddings here yet
// — later Brain Spine steps will add those as separate functions.
//
// Security:
//   - The API key is read from process.env.OPENAI_API_KEY and never logged.
//   - This module is never imported by client code; it lives under server/.
//   - If the key is missing we throw a typed error so the route can return
//     a clear 503 instead of crashing the server with an SDK exception.

import OpenAI from "openai";

export class AIConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AIConfigError";
  }
}

export class AIResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AIResponseError";
  }
}

// Lazy singleton — we don't want to construct the client at module import
// time, otherwise a missing key would crash the server on boot. Build it
// on first use, so the rest of the app keeps working even when OPENAI_API_KEY
// is absent.
let _client: OpenAI | null = null;
function getClient(): OpenAI {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    throw new AIConfigError(
      "OPENAI_API_KEY is not set on the server. AI source processing is disabled until it is configured."
    );
  }
  if (!_client) {
    _client = new OpenAI({
      apiKey: key,
      baseURL: process.env.OPENAI_BASE_URL || undefined,
    });
  }
  return _client;
}

export interface BrainSourceProcessingInput {
  title: string;
  source_type: string;
  source_url?: string | null;
  raw_text: string;
}

// The shape we ask the model to return. Kept loose (`any` on the leaves)
// because the model occasionally returns slightly different value shapes
// (string vs. {name, role}) and we'd rather store the variation than
// reject the whole result. The route stamps the JSON under
// metadata_json.ai_processing_v1 — the "v1" gives us room to evolve the
// shape later without breaking older saved results.
export interface BrainSourceProcessingResult {
  summary: string;
  key_points: string[];
  source_claims: string[];
  entities: {
    people: any[];
    organizations: any[];
    tools: any[];
    places: any[];
    events: any[];
  };
  theology: {
    scripture_refs: any[];
    doctrines: any[];
    traditions_or_positions: any[];
    theological_claims: any[];
  };
  concepts: any[];
  questions_raised: any[];
  possible_card_drafts: Array<{
    title: string;
    description: string;
    tags: string[];
    reason_this_card_matters: string;
  }>;
  possible_connection_drafts: Array<{
    from_title: string;
    to_title: string;
    relationship_type: string;
    label: string;
    reason_this_connection_matters: string;
  }>;
  warnings: string[];
  confidence: "low" | "medium" | "high";
  // Bookkeeping the route attaches; not requested from the model.
  _meta?: {
    model: string;
    processed_at: string;
    raw_text_chars: number;
  };
}

// Cap on how much of raw_text we send to the model in a single call.
// Theology sources can be very long (whole sermons / book chapters). For
// Step 3 we truncate rather than chunk-and-summarize; chunked processing
// is a later-step concern. ~48k chars ≈ ~12k tokens for English prose,
// which fits comfortably under gpt-4o-mini's input window.
const MAX_RAW_TEXT_CHARS = 48_000;

const SYSTEM_PROMPT = `You are the analyst inside a personal "second brain" for a serious Bible student. Your job: read one raw source the user has saved and return structured, faithful analysis as strict JSON.

Hard rules:
- Be faithful to the raw source. Do not invent quotes, Bible references, authors, dates, or claims.
- Distinguish clearly between claims the source makes and beliefs the user holds. The user saving a source does NOT mean the user endorses it. Put source assertions in "source_claims".
- If the source is theological, extract scripture references exactly as written, plus doctrines, objections, and theological positions. Do not fabricate cross-references.
- If the source is about a person (CRM / journal mentioning people), extract people and relational context carefully; do not infer relationships not stated.
- If the source is a personal journal entry, surface themes and questions but do not overclaim emotion or motive.
- Anything you are unsure about: add a short note to "warnings" instead of inventing.
- possible_card_drafts and possible_connection_drafts are PREVIEWS only — they will not be inserted automatically. Aim for high-signal drafts (3–8 cards, 0–8 connections). Each connection's from_title / to_title should reference a card you proposed in possible_card_drafts OR a clearly named real entity from the source.
- Output STRICT JSON matching the schema. No prose outside the JSON object. No markdown fences.`;

function buildUserPrompt(input: BrainSourceProcessingInput): string {
  const meta = [
    `TITLE: ${input.title}`,
    `SOURCE_TYPE: ${input.source_type}`,
    input.source_url ? `SOURCE_URL: ${input.source_url}` : null,
  ].filter(Boolean).join("\n");

  const truncated = input.raw_text.length > MAX_RAW_TEXT_CHARS;
  const body = truncated
    ? input.raw_text.slice(0, MAX_RAW_TEXT_CHARS)
    : input.raw_text;

  return `${meta}

RAW_TEXT${truncated ? ` (truncated to first ${MAX_RAW_TEXT_CHARS} chars of ${input.raw_text.length})` : ""}:
"""
${body}
"""

Return STRICT JSON with exactly this shape (use [] for empty arrays, "" for empty strings, never null inside arrays):
{
  "summary": "short useful summary of the source",
  "key_points": ["point 1", "point 2"],
  "source_claims": ["claims made by the source, not necessarily user beliefs"],
  "entities": {
    "people": [],
    "organizations": [],
    "tools": [],
    "places": [],
    "events": []
  },
  "theology": {
    "scripture_refs": [],
    "doctrines": [],
    "traditions_or_positions": [],
    "theological_claims": []
  },
  "concepts": [],
  "questions_raised": [],
  "possible_card_drafts": [
    {
      "title": "",
      "description": "",
      "tags": [],
      "reason_this_card_matters": ""
    }
  ],
  "possible_connection_drafts": [
    {
      "from_title": "",
      "to_title": "",
      "relationship_type": "",
      "label": "",
      "reason_this_connection_matters": ""
    }
  ],
  "warnings": [],
  "confidence": "low | medium | high"
}`;
}

// Defensive normalization: if the model omits a top-level field we still
// want a usable record. We fill missing fields with the empty shape rather
// than failing the whole processing run.
function normalizeResult(raw: any): BrainSourceProcessingResult {
  const arr = (x: any) => (Array.isArray(x) ? x : []);
  const str = (x: any) => (typeof x === "string" ? x : "");
  const obj = (x: any) => (x && typeof x === "object" && !Array.isArray(x) ? x : {});
  const ent = obj(raw?.entities);
  const theo = obj(raw?.theology);
  const conf = raw?.confidence;
  return {
    summary: str(raw?.summary),
    key_points: arr(raw?.key_points),
    source_claims: arr(raw?.source_claims),
    entities: {
      people: arr(ent.people),
      organizations: arr(ent.organizations),
      tools: arr(ent.tools),
      places: arr(ent.places),
      events: arr(ent.events),
    },
    theology: {
      scripture_refs: arr(theo.scripture_refs),
      doctrines: arr(theo.doctrines),
      traditions_or_positions: arr(theo.traditions_or_positions),
      theological_claims: arr(theo.theological_claims),
    },
    concepts: arr(raw?.concepts),
    questions_raised: arr(raw?.questions_raised),
    possible_card_drafts: arr(raw?.possible_card_drafts),
    possible_connection_drafts: arr(raw?.possible_connection_drafts),
    warnings: arr(raw?.warnings),
    confidence: conf === "high" || conf === "medium" || conf === "low" ? conf : "low",
  };
}

export async function processBrainSourceWithAI(
  input: BrainSourceProcessingInput,
): Promise<BrainSourceProcessingResult> {
  const client = getClient();
  const model = process.env.AI_MODEL || "gpt-4o-mini";

  let completion;
  try {
    completion = await client.chat.completions.create({
      model,
      // JSON mode forces the model to return a parseable object — the
      // schema itself is still enforced by our prompt + normalizeResult.
      response_format: { type: "json_object" },
      temperature: 0.2,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserPrompt(input) },
      ],
    });
  } catch (e: any) {
    // Re-wrap so the route can return a clean message. Do NOT log the
    // input text or the API key.
    throw new AIResponseError(
      `AI request failed: ${e?.message || "unknown error"}`,
    );
  }

  const content = completion.choices?.[0]?.message?.content;
  if (!content) {
    throw new AIResponseError("AI returned an empty response");
  }

  let parsed: any;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new AIResponseError("AI response was not valid JSON");
  }

  const normalized = normalizeResult(parsed);
  normalized._meta = {
    model,
    processed_at: new Date().toISOString(),
    raw_text_chars: input.raw_text.length,
  };
  return normalized;
}

// ─── Brain Chat (Step 5) ────────────────────────────────────────────────
// Read-only AI answer over a compact second-brain context pack. Strict
// JSON output. NEVER writes; NEVER creates cards/connections. Citations
// must point at ids that appear in the supplied context pack — the route
// layer additionally filters out invented ids as defense in depth.

export interface BrainChatCitation {
  type: "source" | "card" | "connection";
  id: number;
  title: string;
}

export interface BrainChatAnswer {
  answer: string;
  citations: BrainChatCitation[];
}

export interface BrainChatInput {
  message: string;
  contextPack: {
    query: string;
    sources: any[];
    cards: any[];
    connections: any[];
    notes: string[];
  };
  history?: Array<{ role: "user" | "assistant"; content: string }>;
}

const CHAT_SYSTEM_PROMPT = `You are a read-only AI assistant inside bereanexamination.com. You answer questions from the user's personal "second brain" (their saved sources, cards, and connections).

Hard rules:
- Use the SECOND_BRAIN_CONTEXT first. If it is sufficient, answer from it.
- If the context is incomplete, say what is missing before adding general reasoning.
- Clearly distinguish "Your brain data says…" from "My general reasoning would add…".
- A source being saved does NOT mean the user endorses it. Distinguish source claims from user beliefs.
- Do NOT invent source IDs, card IDs, connection IDs, quotes, Bible references, or relationships.
- When you use a source/card/connection from the context, cite it by EXACT id and title in the "citations" array. Only cite ids that appear in SECOND_BRAIN_CONTEXT.
- You CANNOT modify the second brain. You cannot create, edit, delete, approve, or save anything. If the user asks you to create a card or connection, tell them writing is not enabled in this step yet.
- If no relevant context is found, say so plainly, then optionally answer with general knowledge.
- Output STRICT JSON only — no markdown fences, no prose outside the JSON object.`;

function formatContextForPrompt(pack: BrainChatInput["contextPack"]): string {
  const parts: string[] = [];
  parts.push(`QUERY_USED_FOR_RETRIEVAL: ${pack.query || "(none)"}`);
  if (pack.sources.length > 0) {
    parts.push(`\nSOURCES (${pack.sources.length}):`);
    for (const s of pack.sources) {
      const lines = [
        `- [source #${s.id}] "${s.title || "(untitled)"}" (${s.source_type || "?"}; ${s.processing_status || "?"})`,
        s.source_url ? `  url: ${s.source_url}` : null,
        s.ai_summary ? `  ai_summary: ${String(s.ai_summary).slice(0, 600)}` : null,
        s.raw_text_snippet ? `  raw_snippet: ${s.raw_text_snippet}` : null,
      ].filter(Boolean);
      parts.push(lines.join("\n"));
    }
  } else {
    parts.push("\nSOURCES: (none)");
  }
  if (pack.cards.length > 0) {
    parts.push(`\nCARDS (${pack.cards.length}):`);
    for (const c of pack.cards) {
      const lines = [
        `- [card #${c.id}] "${c.title || "(untitled)"}" (${c.status || "?"}; by ${c.created_by || "?"})`,
        c.tags ? `  tags: ${c.tags}` : null,
        c.description_snippet ? `  description: ${c.description_snippet}` : null,
        Array.isArray(c.source_ids) && c.source_ids.length ? `  cites sources: [${c.source_ids.join(", ")}]` : null,
      ].filter(Boolean);
      parts.push(lines.join("\n"));
    }
  } else {
    parts.push("\nCARDS: (none)");
  }
  if (pack.connections.length > 0) {
    parts.push(`\nCONNECTIONS (${pack.connections.length}):`);
    for (const co of pack.connections) {
      const lines = [
        `- [connection #${co.id}] card #${co.from_card_id} —${co.relationship_type || "related_to"}→ card #${co.to_card_id}`,
        co.label ? `  label: ${co.label}` : null,
        co.evidence_snippet ? `  evidence: ${co.evidence_snippet}` : null,
      ].filter(Boolean);
      parts.push(lines.join("\n"));
    }
  } else {
    parts.push("\nCONNECTIONS: (none)");
  }
  if (pack.notes.length > 0) parts.push(`\nNOTES: ${pack.notes.join(" | ")}`);
  return parts.join("\n");
}

const CHAT_OUTPUT_INSTRUCTION = `Return STRICT JSON with exactly this shape:
{
  "answer": "your conversational answer",
  "citations": [
    { "type": "source", "id": 123, "title": "exact title from SECOND_BRAIN_CONTEXT" }
  ]
}
citations may be []. Never invent ids or titles.`;

export async function askBrainChatAI(input: BrainChatInput): Promise<BrainChatAnswer> {
  const client = getClient();
  const model = process.env.AI_MODEL || "gpt-4o-mini";

  const history = (input.history || []).map(m => ({
    role: m.role,
    content: m.content,
  }));

  const userBlock = `SECOND_BRAIN_CONTEXT:
"""
${formatContextForPrompt(input.contextPack)}
"""

USER_MESSAGE:
"""
${input.message}
"""

${CHAT_OUTPUT_INSTRUCTION}`;

  let completion;
  try {
    completion = await client.chat.completions.create({
      model,
      response_format: { type: "json_object" },
      temperature: 0.3,
      messages: [
        { role: "system", content: CHAT_SYSTEM_PROMPT },
        ...history,
        { role: "user", content: userBlock },
      ],
    });
  } catch (e: any) {
    throw new AIResponseError(`AI request failed: ${e?.message || "unknown error"}`);
  }

  const content = completion.choices?.[0]?.message?.content;
  if (!content) throw new AIResponseError("AI returned an empty response");

  let parsed: any;
  try {
    parsed = JSON.parse(content);
  } catch {
    // Graceful fallback: hand back the raw text as the answer rather than
    // 500-ing the route. Citations become empty.
    return { answer: String(content).slice(0, 4000), citations: [] };
  }

  const answer = typeof parsed?.answer === "string" ? parsed.answer : "";
  const rawCitations = Array.isArray(parsed?.citations) ? parsed.citations : [];
  const citations: BrainChatCitation[] = [];
  for (const c of rawCitations) {
    if (!c || typeof c !== "object") continue;
    const type = c.type === "source" || c.type === "card" || c.type === "connection" ? c.type : null;
    const id = typeof c.id === "number" ? c.id : Number(c.id);
    const title = typeof c.title === "string" ? c.title : "";
    if (type && Number.isFinite(id)) citations.push({ type, id, title });
  }
  return { answer: answer || "(no answer)", citations };
}
