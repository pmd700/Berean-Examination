/** Inert prompt contracts retained for a future explicitly enabled Online Mode. */

export const CHAPTER_INSIGHTS_SCHEMA = Object.freeze({
  type: 'object',
  properties: {
    summary: { type: 'string', description: 'A brief 2-3 sentence summary of the chapter' },
    context: { type: 'string', description: 'Historical and cultural context of the chapter' },
    questions: {
      type: 'array',
      items: { type: 'string' },
      description: 'Three thought-provoking study questions',
    },
  },
  required: ['summary', 'context', 'questions'],
});

export const URL_METADATA_SCHEMA = Object.freeze({
  type: 'object',
  properties: {
    title: { type: 'string' },
    description: { type: 'string' },
    favicon: { type: 'string' },
    image: { type: 'string' },
  },
  required: ['title'],
});

export function buildChapterInsightsContract({ chapterText, book, chapter }) {
  return {
    prompt: `You are an expert Bible scholar. Analyze the following chapter (${book} ${chapter}):\n${chapterText}\n\nPlease provide:\n1. A brief summary (2-3 sentences)\n2. Historical/Cultural context\n3. 3 thought-provoking study questions`,
    requiresInternetContext: false,
    responseSchema: CHAPTER_INSIGHTS_SCHEMA,
  };
}

export function buildUrlMetadataContract(url) {
  return {
    prompt: `Extract metadata from this URL: ${url}\n\nReturn the following information:\n- title: The page title\n- description: A brief description or summary (max 200 characters)\n- favicon: The favicon URL if available\n- image: The main image or thumbnail URL if available\n\nBe concise and accurate.`,
    requiresInternetContext: true,
    responseSchema: URL_METADATA_SCHEMA,
  };
}

export function buildUrlImportContract(url) {
  return {
    prompt: `Extract the main content from this URL: ${url}\n\nPlease extract:\n1. The title\n2. The main body content in a clean, readable format\n3. Remove navigation, ads, footers, and other non-content elements\n4. Format as markdown for easy reading\n\nReturn the content ready to be pasted into a study environment.`,
    requiresInternetContext: true,
    responseSchema: null,
  };
}
