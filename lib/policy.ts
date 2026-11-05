/**
 * Finds stored Northline policy passages by vector similarity. searchPolicy embeds
 * the question with the same model used for the chunk text, then returns nearest
 * rows from policy_chunks whose cosine similarity meets the cutoff: document id,
 * chunk id, source title, and the passage exactly as stored. Below that cutoff
 * the passage list is empty and the message says the policy does not contain this.
 * The cutoff does not prove relevance, invent a passage, or decide a refund.
 * embedPolicyChunks fills the embedding column from each stored passage. Neither
 * function changes chat or pending refunds.
 */

import { withClient } from "./postgres";

/** Must match the vector(1536) column. text-embedding-3-small defaults to 1536. */
export const EMBEDDING_MODEL = "text-embedding-3-small";
export const EMBEDDING_DIMENSIONS = 1536;

const EMBEDDINGS_URL = "https://api.openai.com/v1/embeddings";

/** Nearest passages to return after the similarity cutoff (CLI and evals). */
const DEFAULT_MATCH_COUNT = 5;

/** Chat and MCP search_policy return the two best-matching passages for operators. */
export const OPERATOR_POLICY_MATCH_COUNT = 2;

/**
 * Minimum cosine similarity (1 minus cosine distance) for a stored passage to count.
 * Calibrated in M19 on text-embedding-3-small. Known-supported questions scored at
 * least 0.476 ("annual refund window" → refunds / refunds-annual-plans). Known-unsupported
 * questions scored at most 0.370 ("crypto refund"). 0.45 sits in that gap. It does
 * not prove that a passage answers the question. M25 checks the same split again.
 */
export const SIMILARITY_CUTOFF = 0.45;

/** Used only when every passage is below SIMILARITY_CUTOFF. */
export const POLICY_MISS_MESSAGE = "The policy does not contain this.";

export type PolicyPassage = {
  documentId: string;
  chunkId: string;
  sourceTitle: string;
  passage: string;
};

export type PolicySearchResult = {
  passages: PolicyPassage[];
  /** Null when at least one passage meets the cutoff. */
  message: string | null;
};

/** Stored document ids map to policy-desk markdown files (`refunds` → `refunds.md`). */
export function formatPolicySourcePath(documentId: string, chunkId: string): string {
  return `policy-desk/${documentId}.md#${chunkId}`;
}

export function collectPolicySourcePaths(passages: readonly PolicyPassage[]): string[] {
  const seen = new Set<string>();
  const paths: string[] = [];
  for (const passage of passages) {
    const key = `${passage.documentId}\0${passage.chunkId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    paths.push(formatPolicySourcePath(passage.documentId, passage.chunkId));
  }
  return paths;
}

type ChunkRow = {
  document_id: string;
  chunk_id: string;
  passage: string;
};

type PassageRow = {
  document_id: string;
  chunk_id: string;
  source_title: string;
  passage: string;
};

export async function embedPolicyChunks(): Promise<number> {
  const rows = await withClient(async (client) => {
    const result = await client.query<ChunkRow>(
      `select document_id, chunk_id, passage
       from public.policy_chunks
       order by document_id, chunk_id`,
    );
    return result.rows;
  });

  if (rows.length === 0) {
    throw new Error("policy_chunks has no passages to embed.");
  }

  const vectors = await embedTexts(rows.map((row) => row.passage));

  await withClient(async (client) => {
    try {
      await client.query("begin");
      for (let index = 0; index < rows.length; index += 1) {
        const row = rows[index];
        const vector = vectors[index];
        if (!row || !vector) {
          throw new Error("Embedding count did not match the policy chunks.");
        }
        const updated = await client.query(
          `update public.policy_chunks
           set embedding = $1::extensions.vector
           where document_id = $2 and chunk_id = $3`,
          [toVectorLiteral(vector), row.document_id, row.chunk_id],
        );
        if (updated.rowCount !== 1) {
          throw new Error(`Could not store the embedding for ${row.document_id} / ${row.chunk_id}.`);
        }
      }
      await client.query("commit");
    } catch (error) {
      try {
        await client.query("rollback");
      } catch {
        // The connection may already be closed. The updates did not commit.
      }
      throw error;
    }
  });

  return rows.length;
}

/**
 * Refund policy, eligibility, timeline, or "how many days" questions should
 * return the monthly and annual windows. Nearest-neighbour search ranks the
 * payout paragraph ("10 business days") above those windows.
 */
export function prefersRefundWindows(query: string): boolean {
  const lower = query.toLowerCase();
  const aboutRefund = /\brefunds?\b/.test(lower);
  const aboutWindow =
    (/\b(annual|monthly)\b/.test(lower) && /\b(refund|window)\b/.test(lower)) ||
    (aboutRefund &&
      (/\bpolic(?:y|ies)\b/.test(lower) ||
        /\beligib/.test(lower) ||
        /\bwindow\b/.test(lower) ||
        /\bhow long\b/.test(lower) ||
        /\btimeline\b/.test(lower) ||
        /\bdays?\b/.test(lower)));
  if (!aboutWindow) return false;
  const aboutPayout =
    /\bbusiness days\b/.test(lower) ||
    /\bpayment method\b/.test(lower) ||
    /\bexception\b/.test(lower) ||
    /\boriginal payment\b/.test(lower) ||
    /\bmoney is returned\b/.test(lower);
  const aboutEligibility = /\beligib|\bwindow\b|\bmonthly\b|\bannual\b|\bdays?\b/.test(lower);
  return !aboutPayout || aboutEligibility;
}

function refundWindowKeys(query: string): Array<{ documentId: string; chunkId: string }> {
  const lower = query.toLowerCase();
  const annual = { documentId: "refunds", chunkId: "refunds-annual-plans" };
  const monthly = { documentId: "refunds", chunkId: "refunds-monthly-plans" };
  if (/\bannual\b/.test(lower) && !/\bmonthly\b/.test(lower)) return [annual, monthly];
  return [monthly, annual];
}

async function loadPolicyPassages(
  keys: readonly { documentId: string; chunkId: string }[],
): Promise<PolicyPassage[]> {
  if (keys.length === 0) return [];
  return withClient(async (client) => {
    const result = await client.query<PassageRow>(
      `select document_id, chunk_id, source_title, passage
       from public.policy_chunks
       where (document_id, chunk_id) in (
         select * from unnest($1::text[], $2::text[])
       )`,
      [keys.map((key) => key.documentId), keys.map((key) => key.chunkId)],
    );
    const byKey = new Map(
      result.rows.map((row) => [`${row.document_id}\0${row.chunk_id}`, row] as const),
    );
    return keys.flatMap((key) => {
      const row = byKey.get(`${key.documentId}\0${key.chunkId}`);
      if (!row) return [];
      return [
        {
          documentId: row.document_id,
          chunkId: row.chunk_id,
          sourceTitle: row.source_title,
          passage: row.passage,
        },
      ];
    });
  });
}

export async function searchPolicy(query: string, limit = DEFAULT_MATCH_COUNT): Promise<PolicySearchResult> {
  const question = query.trim();
  if (!question) {
    throw new Error("Enter a policy question.");
  }

  if (prefersRefundWindows(question)) {
    const windows = await loadPolicyPassages(refundWindowKeys(question));
    if (windows.length > 0) return { passages: windows, message: null };
  }

  const matchCount = readMatchCount(limit);
  const [queryEmbedding] = await embedTexts([question]);
  if (!queryEmbedding) {
    throw new Error("Could not embed the policy question.");
  }

  return withClient(async (client) => {
    const missing = await client.query<{ n: number }>(
      `select count(*)::int as n
       from public.policy_chunks
       where embedding is null`,
    );
    const missingCount = missing.rows[0]?.n;
    if (typeof missingCount !== "number") {
      throw new Error("Could not check policy embeddings.");
    }
    if (missingCount > 0) {
      throw new Error("Policy chunks have no embeddings yet. Run npm run embed:policy.");
    }

    // <=> is cosine distance. Similarity is 1 minus that distance.
    const maxCosineDistance = 1 - SIMILARITY_CUTOFF;
    const result = await client.query<PassageRow>(
      `select document_id, chunk_id, source_title, passage
       from public.policy_chunks
       where embedding operator(extensions.<=>) $1::extensions.vector <= $3
       order by embedding operator(extensions.<=>) $1::extensions.vector
       limit $2`,
      [toVectorLiteral(queryEmbedding), matchCount, maxCosineDistance],
    );

    const passages = result.rows.map((row) => ({
      documentId: row.document_id,
      chunkId: row.chunk_id,
      sourceTitle: row.source_title,
      passage: row.passage,
    }));

    if (passages.length === 0) {
      return { passages, message: POLICY_MISS_MESSAGE };
    }

    return { passages, message: null };
  });
}

async function embedTexts(texts: string[]): Promise<number[][]> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "Set OPENAI_API_KEY in the server environment. Do not send it to the browser.",
    );
  }

  for (const text of texts) {
    if (typeof text !== "string" || text.length === 0) {
      throw new Error("Cannot embed an empty passage.");
    }
  }

  const response = await fetch(EMBEDDINGS_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: texts,
      dimensions: EMBEDDING_DIMENSIONS,
    }),
  });

  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = providerMessage(payload, apiKey);
    throw new Error(detail ? `Could not embed text: ${detail}` : `Could not embed text (${response.status}).`);
  }

  return readEmbeddings(payload, texts.length);
}

function readEmbeddings(payload: unknown, expected: number): number[][] {
  if (typeof payload !== "object" || payload === null) {
    throw new Error("Embedding response was not an object.");
  }

  const data = (payload as { data?: unknown }).data;
  if (!Array.isArray(data) || data.length !== expected) {
    throw new Error("Embedding response did not include one vector per passage.");
  }

  const ordered: number[][] = new Array(expected);
  for (const item of data) {
    if (typeof item !== "object" || item === null) {
      throw new Error("Embedding response included an invalid vector.");
    }
    const row = item as { index?: unknown; embedding?: unknown };
    if (typeof row.index !== "number" || !Number.isInteger(row.index) || row.index < 0 || row.index >= expected) {
      throw new Error("Embedding response included an invalid index.");
    }
    if (ordered[row.index]) {
      throw new Error("Embedding response repeated an index.");
    }
    ordered[row.index] = readVector(row.embedding);
  }

  if (ordered.some((vector) => !vector)) {
    throw new Error("Embedding response was missing a vector.");
  }

  return ordered;
}

function readVector(value: unknown): number[] {
  if (!Array.isArray(value) || value.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(`Expected an embedding with ${EMBEDDING_DIMENSIONS} dimensions.`);
  }

  const vector: number[] = [];
  for (const component of value) {
    if (typeof component !== "number" || !Number.isFinite(component)) {
      throw new Error("Embedding contained a non-finite number.");
    }
    vector.push(component);
  }
  return vector;
}

function toVectorLiteral(values: number[]): string {
  return `[${values.join(",")}]`;
}

function readMatchCount(limit: number): number {
  if (!Number.isInteger(limit) || limit < 1 || limit > 20) {
    throw new Error("Match count must be a whole number from 1 to 20.");
  }
  return limit;
}

function providerMessage(payload: unknown, apiKey: string): string {
  if (typeof payload !== "object" || payload === null) return "";
  const error = (payload as { error?: unknown }).error;
  if (typeof error !== "object" || error === null) return "";
  const message = (error as { message?: unknown }).message;
  if (typeof message !== "string") return "";
  return message.split(apiKey).join("[redacted]").slice(0, 300);
}
