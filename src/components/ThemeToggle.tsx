import type { ReactNode } from "react";
import { useTheme, type ThemePreference } from "../theme.ts";

const icon = { width: 14, height: 14, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2 } as const;

const OPTIONS: { value: ThemePreference; label: string; svg: ReactNode }[] = [
  {
    value: "system",
    label: "System",
    svg: (
      <svg {...icon} aria-hidden>
        <rect x="3" y="4" width="18" height="12" rx="1.5" />
        <path d="M8 20h8M12 16v4" />
      </svg>
    ),
  },
  {
    value: "light",
    label: "Light",
    svg: (
      <svg {...icon} aria-hidden>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </svg>
    ),
  },
  {
    value: "dark",
    label: "Dark",
    svg: (
      <svg {...icon} aria-hidden>
        <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />
      </svg>
    ),
  },
];

export function ThemeToggle() {
  const [preference, setPreference] = useTheme();
  return (
    <div role="group" aria-label="Color theme" className="flex rounded-md border border-line bg-card p-0.5 text-xs">
      {OPTIONS.map((o) => {
        const selected = preference === o.value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={selected}
            onClick={() => setPreference(o.value)}
            className={`flex items-center gap-1.5 rounded px-2 py-1 font-medium ${
              selected ? "bg-accent text-accent-ink" : "text-muted hover:text-ink"
            }`}
          >
            {o.svg}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
