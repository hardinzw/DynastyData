import { useState } from "react";

// Sleeper's headshot CDN. Undocumented, like the stats endpoints, but its own app uses it.
// Unknown players get a 403 rather than a placeholder, so we fall back to initials.
const headshotUrl = (playerId: string) => `https://sleepercdn.com/content/nfl/players/thumb/${playerId}.jpg`;

function initials(name: string): string {
  const parts = name.split(" ").filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts.at(-1)![0] : "")).toUpperCase();
}

export function PlayerPhoto({ playerId, name }: { playerId: string; name: string }) {
  const [failed, setFailed] = useState(false);
  const frame = "h-10 w-10 shrink-0 rounded-full bg-slate-800";

  if (failed) {
    return (
      <div className={`${frame} flex items-center justify-center text-xs font-medium text-slate-400`} aria-hidden>
        {initials(name)}
      </div>
    );
  }
  return (
    <img
      src={headshotUrl(playerId)}
      alt=""
      loading="lazy"
      decoding="async"
      width={40}
      height={40}
      onError={() => setFailed(true)}
      className={`${frame} object-cover object-top`}
    />
  );
}
