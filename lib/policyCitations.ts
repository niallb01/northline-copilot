/**
 * Decides whether a policy quote counts. A quote counts only when its document
 * id and chunk id were in that turn's search_policy passages and the quote
 * appears in that same passage. A quote taken from a different chunk does not
 * count, even if some of the words match. This file does not search, embed, or
 * queue a refund.
 */

export const POLICY_REFUSAL = "The stored policy does not cover that topic.";

export type PolicyCitation = {
  documentId: string;
  chunkId: string;
  quote: string;
};

/** One retrieved passage, shaped for the citations panel. */
export type PolicyPassageView = {
  documentId: string;
  chunkId: string;
  path: string;
  text: string;
};

type StoredPassage = {
  documentId: string;
  chunkId: string;
  passage: string;
};

export function acceptPolicyQuote(
  citation: PolicyCitation,
  passages: readonly StoredPassage[],
): boolean {
  const documentId = citation.documentId.trim();
  const chunkId = citation.chunkId.trim();
  const quote = citation.quote.trim();
  if (!documentId || !chunkId || !quote) return false;

  const passage = passages.find(
    (row) => row.documentId === documentId && row.chunkId === chunkId,
  );
  if (!passage) return false;
  return quoteAppearsInPassage(quote, passage.passage);
}

/** True when the quote is a contiguous stretch of that passage. Whitespace runs compare equal. */
export function quoteAppearsInPassage(quote: string, passage: string): boolean {
  const text = quote.trim();
  if (!text) return false;
  if (passage.includes(text)) return true;
  const collapsedQuote = collapseWhitespace(text);
  const collapsedPassage = collapseWhitespace(passage);
  return collapsedQuote.length > 0 && collapsedPassage.includes(collapsedQuote);
}

export function settlePolicyCitations(
  reply: string,
  passages: readonly StoredPassage[],
): { reply: string; citations: PolicyCitation[]; rejected: PolicyCitation[] } {
  const citeTag = /<cite\b([^>]*)>([\s\S]*?)<\/cite>/gi;
  const citations: PolicyCitation[] = [];
  const rejected: PolicyCitation[] = [];
  const seen = new Set<string>();
  let sawTag = false;

  const unwrapped = reply.replace(citeTag, (_full, attrs: string, inner: string, offset: number) => {
    sawTag = true;
    const documentId = readAttr(attrs, "document", "documentId");
    const chunkId = readAttr(attrs, "chunk", "chunkId");
    const rawQuote = inner.trim();
    const citation = matchingQuote({ documentId, chunkId, quote: rawQuote }, passages);
    if (citation) {
      const key = `${citation.documentId}\0${citation.chunkId}\0${citation.quote}`;
      if (!seen.has(key)) {
        seen.add(key);
        citations.push(citation);
      }
      const before = reply[offset - 1] ?? "";
      const pad = before && !/\s/.test(before) ? " " : "";
      return pad + plainPolicyText(citation.quote);
    }
    rejected.push({ documentId, chunkId, quote: rawQuote });
    return "";
  });

  if (!sawTag) {
    return { reply: reply.trim(), citations, rejected };
  }

  const cleaned = tidy(preferCitedPassage(dropRepeatedSentences(plainPolicyText(unwrapped)), citations));
  return {
    reply: cleaned || (passages.length === 0 ? POLICY_REFUSAL : "I can only quote a passage the policy search returned."),
    citations,
    rejected,
  };
}

function matchingQuote(
  citation: PolicyCitation,
  passages: readonly StoredPassage[],
): PolicyCitation | null {
  if (acceptPolicyQuote(citation, passages)) return citation;
  const unwrapped = unwrapSurroundingQuotes(citation.quote);
  if (!unwrapped || unwrapped === citation.quote) return null;
  const inner: PolicyCitation = { ...citation, quote: unwrapped };
  return acceptPolicyQuote(inner, passages) ? inner : null;
}

/** Models often wrap an exact passage in quotation marks. Those marks are not part of the quote. */
function unwrapSurroundingQuotes(quote: string): string {
  const match = quote.match(/^(["“'])([\s\S]*)(["”'])$/);
  return match?.[2]?.trim() ?? "";
}

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function readAttr(attrs: string, ...names: string[]): string {
  for (const name of names) {
    const match = attrs.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*"([^"]*)"`, "i"));
    if (match?.[1]) return match[1].trim();
  }
  return "";
}

/** Stored passages start with a markdown heading. The chat and citations panel show the sentences. */
export function plainPolicyText(text: string): string {
  const lines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const body = lines.filter((line) => !/^#{1,6}\s+/.test(line));
  return (body.length > 0 ? body : lines).join(" ").replace(/#{1,6}\s+/g, "").replace(/[ \t]{2,}/g, " ").trim();
}

function preferCitedPassage(text: string, citations: readonly PolicyCitation[]): string {
  for (const citation of citations) {
    const plain = plainPolicyText(citation.quote);
    const opening = collapseWhitespace(plain).slice(0, 48).toLowerCase();
    if (opening.length < 48) continue;
    const body = collapseWhitespace(text).toLowerCase();
    const first = body.indexOf(opening);
    if (first === -1) continue;
    if (body.indexOf(opening, first + opening.length) === -1) continue;
    return plain;
  }
  return text;
}

function dropRepeatedSentences(text: string): string {
  const parts = text.split(/(?<=[.!?])\s+/).map((part) => part.trim()).filter(Boolean);
  const kept: string[] = [];
  for (const part of parts) {
    const index = kept.findIndex((previous) => samePoint(previous, part));
    if (index === -1) kept.push(part);
    else kept[index] = part;
  }
  return kept.join(" ");
}

function samePoint(left: string, right: string): boolean {
  const a = collapseWhitespace(left).toLowerCase();
  const b = collapseWhitespace(right).toLowerCase();
  if (a.includes(b) || b.includes(a)) return true;
  const span = 48;
  return a.length >= span && b.length >= span && a.slice(0, span) === b.slice(0, span);
}

function tidy(text: string): string {
  return text
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
