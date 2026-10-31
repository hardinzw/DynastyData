import type { Position } from "../../shared/positions.ts";

// Written out in full so Tailwind finds the class names. QB has no color of its own yet.
export const POSITION_TEXT: Record<Position, string> = {
  QB: "text-ink",
  RB: "text-rb",
  WR: "text-wr",
  TE: "text-te",
};

export const POSITION_TAG: Record<Position, string> = {
  QB: "text-ink bg-ink/10",
  RB: "text-rb bg-rb/12",
  WR: "text-wr bg-wr/12",
  TE: "text-te bg-te/12",
};

export const POSITION_RING: Record<Position, string> = {
  QB: "ring-ink/40",
  RB: "ring-rb/60",
  WR: "ring-wr/60",
  TE: "ring-te/60",
};
