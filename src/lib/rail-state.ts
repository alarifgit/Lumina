export interface RailEdgeState {
  canScrollLeft: boolean;
  canScrollRight: boolean;
  maxScroll: number;
}

/**
 * Compute both rail boundaries from one normalized measurement so the left
 * and right controls always use the same tolerance and geometry rules.
 */
export function getRailEdgeState(
  scrollLeft: number,
  scrollWidth: number,
  clientWidth: number,
  tolerance = 6
): RailEdgeState {
  const maxScroll = Math.max(0, scrollWidth - clientWidth);
  const position = Math.min(maxScroll, Math.max(0, scrollLeft));

  return {
    canScrollLeft: maxScroll > tolerance && position > tolerance,
    canScrollRight: maxScroll > tolerance && position < maxScroll - tolerance,
    maxScroll,
  };
}

export function getRailPageDistance(clientWidth: number) {
  return Math.max(280, clientWidth * 0.82);
}
