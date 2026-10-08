// Pure text helpers preserved for the dormant Online Mode AI Spine.
// They have no database, account, network, or Electron dependency.

export function htmlToPlainText(input: string | null | undefined): string {
  if (!input) return "";
  let value = String(input);
  value = value.replace(/<\s*(br|p|div|li|h[1-6])\b[^>]*>/gi, "\n");
  value = value.replace(/<\s*\/\s*(p|div|li|h[1-6])\s*>/gi, "\n");
  value = value.replace(/<[^>]+>/g, "");
  value = value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_match, code) => {
      try {
        return String.fromCharCode(Number.parseInt(code, 10));
      } catch {
        return "";
      }
    });
  return value.replace(/[ \t\u00A0]+/g, " ").replace(/\s*\n\s*/g, " ").trim();
}

export function safeParseTags(raw: unknown): string[] {
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw.map(String);
  const value = String(raw).trim();
  if (!value) return [];
  if (value.startsWith("[") || value.startsWith('"')) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.map(String);
      if (typeof parsed === "string") return [parsed];
    } catch {
      // Legacy comma-separated tags continue below.
    }
  }
  return value.split(",").map((tag) => tag.trim()).filter(Boolean);
}
