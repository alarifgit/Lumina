export interface ParsedMediaTitle {
  title: string;
  year?: number;
}

const TRAILING_YEAR = /\(?\b(19\d{2}|20\d{2})\b\)?\s*$/;

/**
 * Split a trailing release year without mistaking numeric titles such as
 * "1917" or future-number titles such as "Blade Runner 2049" for metadata.
 */
export function splitTrailingReleaseYear(
  raw: string,
  fallbackYear?: number
): ParsedMediaTitle {
  const normalized = raw.replace(/\s+/g, " ").trim();
  const match = normalized.match(TRAILING_YEAR);

  if (match?.index !== undefined) {
    const baseTitle = normalized.slice(0, match.index).replace(/\s+/g, " ").trim();
    const candidateYear = Number(match[1]);
    const latestLikelyReleaseYear = new Date().getFullYear() + 5;
    const plausibleReleaseYear =
      candidateYear >= 1888 && candidateYear <= latestLikelyReleaseYear;
    const numericBaseTitle = /^(19\d{2}|20\d{2})$/.test(baseTitle);

    if (
      baseTitle &&
      (numericBaseTitle || plausibleReleaseYear || candidateYear === fallbackYear)
    ) {
      return { title: baseTitle, year: candidateYear };
    }
  }

  const numericOnlyTitle = /^(19\d{2}|20\d{2})$/.test(normalized);
  const safeFallback =
    numericOnlyTitle && Number(normalized) === fallbackYear
      ? undefined
      : fallbackYear;

  return { title: normalized || raw, year: safeFallback };
}
