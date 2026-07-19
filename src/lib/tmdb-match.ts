export interface TmdbAutoMatchCandidate {
  tmdbId: number;
  title: string;
  originalTitle?: string | null;
  year: number | null;
}

export type TmdbAutoMatchReason =
  | "matched"
  | "no-candidates"
  | "no-exact-title"
  | "year-mismatch"
  | "ambiguous";

export interface TmdbAutoMatchDecision<T extends TmdbAutoMatchCandidate> {
  match: T | null;
  reason: TmdbAutoMatchReason;
  eligible: T[];
}

export function normalizeTmdbMatchTitle(value: string | null | undefined) {
  return String(value ?? "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * Automatic metadata matching is intentionally conservative. Search rank is
 * not identity: only one exact normalized title (and exact source year, when
 * known) may be selected without user confirmation.
 */
export function decideTmdbAutoMatch<T extends TmdbAutoMatchCandidate>(
  sourceTitle: string,
  sourceYear: number | null | undefined,
  candidates: T[]
): TmdbAutoMatchDecision<T> {
  const uniqueCandidates = [
    ...new Map(candidates.map((candidate) => [candidate.tmdbId, candidate])).values(),
  ];
  if (uniqueCandidates.length === 0) {
    return { match: null, reason: "no-candidates", eligible: [] };
  }

  const sourceIdentity = normalizeTmdbMatchTitle(sourceTitle);
  const titleMatches = uniqueCandidates.filter((candidate) =>
    [candidate.title, candidate.originalTitle].some(
      (candidateTitle) =>
        !!sourceIdentity && normalizeTmdbMatchTitle(candidateTitle) === sourceIdentity
    )
  );
  if (titleMatches.length === 0) {
    return { match: null, reason: "no-exact-title", eligible: [] };
  }

  const eligible =
    sourceYear == null
      ? titleMatches
      : titleMatches.filter((candidate) => candidate.year === sourceYear);
  if (eligible.length === 0) {
    return { match: null, reason: "year-mismatch", eligible: [] };
  }
  if (eligible.length !== 1) {
    return { match: null, reason: "ambiguous", eligible };
  }
  return { match: eligible[0], reason: "matched", eligible };
}
