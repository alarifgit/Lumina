import type { MediaType } from "@/lib/types";

/** Keep Plex preview rows aligned with the selected Lumina section type. */
export function plexItemMatchesSectionType(
  plexType: string | null | undefined,
  sectionType: MediaType | null | undefined
) {
  if (!sectionType) return true;
  return sectionType === "TV" ? plexType === "episode" : plexType !== "episode";
}
