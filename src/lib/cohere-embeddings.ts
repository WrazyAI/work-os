const COHERE_EMBED_API = "https://api.cohere.com/v2/embed";

export const MEMORY_EMBEDDING_MODEL = process.env.WORK_MEMORY_EMBEDDING_MODEL?.trim() || "embed-v4.0";
export const MEMORY_EMBEDDING_DIMENSIONS = 1024;
export const MEMORY_EMBEDDING_PROVIDER = "cohere";

interface CohereEmbedResponse {
  embeddings?: { float?: number[][] };
  meta?: { billed_units?: { input_tokens?: number } };
  message?: string;
}

export interface MemoryEmbeddingResult {
  embeddings: number[][];
  inputTokens: number;
}

/** Embeds Work Memory text with Cohere embed-v4.0 at 1024 dims. One call
 * accepts 1–96 inputs; callers with more should use embedMemoryTextsBatched. */
export async function embedMemoryTexts(
  texts: string[],
  inputType: "search_document" | "search_query",
): Promise<MemoryEmbeddingResult> {
  const apiKey = process.env.COHERE_API_KEY?.trim();
  if (!apiKey) throw new Error("COHERE_API_KEY is not configured.");
  if (!texts.length || texts.length > 96) throw new Error("Cohere embedding batches must contain 1–96 inputs.");

  const response = await fetch(COHERE_EMBED_API, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      model: MEMORY_EMBEDDING_MODEL,
      texts,
      input_type: inputType,
      embedding_types: ["float"],
      output_dimension: MEMORY_EMBEDDING_DIMENSIONS,
      truncate: "END",
    }),
    cache: "no-store",
  });
  const body = (await response.json().catch(() => ({}))) as CohereEmbedResponse;
  if (!response.ok) throw new Error(body.message || `Cohere Embed failed (${response.status}).`);
  const embeddings = body.embeddings?.float;
  if (!embeddings || embeddings.length !== texts.length) {
    throw new Error("Cohere Embed returned an unexpected embedding count.");
  }
  if (embeddings.some((embedding) => embedding.length !== MEMORY_EMBEDDING_DIMENSIONS)) {
    throw new Error(`Cohere Embed did not return ${MEMORY_EMBEDDING_DIMENSIONS}-dimensional vectors.`);
  }
  return { embeddings, inputTokens: Number(body.meta?.billed_units?.input_tokens || 0) };
}

export async function embedMemoryTextsBatched(
  texts: string[],
  inputType: "search_document" | "search_query",
  batchSize = 64,
): Promise<{ embeddings: number[][]; inputTokens: number }> {
  const embeddings: number[][] = [];
  let inputTokens = 0;
  for (let start = 0; start < texts.length; start += batchSize) {
    const batch = texts.slice(start, start + batchSize);
    const result = await embedMemoryTexts(batch, inputType);
    embeddings.push(...result.embeddings);
    inputTokens += result.inputTokens;
  }
  return { embeddings, inputTokens };
}

export function memoryEmbeddingConfigured(): boolean {
  return Boolean(process.env.COHERE_API_KEY?.trim());
}
