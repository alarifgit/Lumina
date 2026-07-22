export function resolveActiveFeatureIndex(
  featureIds: string[],
  activeId: string | null
) {
  if (!featureIds.length) return -1;
  if (!activeId) return 0;
  const index = featureIds.indexOf(activeId);
  return index >= 0 ? index : 0;
}

export function normalizeFeatureIndex(length: number, index: number) {
  if (length <= 0) return -1;
  return ((index % length) + length) % length;
}
