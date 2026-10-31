// Positions the app ingests data for. QB is ingested so team totals and
// future QB support work, but only ENABLED_POSITIONS are ranked.
export const INGESTED_POSITIONS = ["QB", "RB", "WR", "TE"] as const;
export type Position = (typeof INGESTED_POSITIONS)[number];

// Add "QB" here to turn on QB breakout ranking.
export const ENABLED_POSITIONS: readonly Position[] = ["RB", "WR", "TE"];

export function isIngestedPosition(p: string | null | undefined): p is Position {
  return (INGESTED_POSITIONS as readonly string[]).includes(p ?? "");
}
