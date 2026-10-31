import { useEffect, useState } from "react";

export type ThemePreference = "system" | "light" | "dark";

// Keep in sync with the inline script in index.html, which applies the theme before first paint.
const STORAGE_KEY = "theme";
const DARK_QUERY = "(prefers-color-scheme: dark)";

function readPreference(): ThemePreference {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    // Storage can be blocked; fall back to the system setting.
  }
  return "system";
}

function apply(preference: ThemePreference) {
  const dark = preference === "dark" || (preference === "system" && matchMedia(DARK_QUERY).matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}

/** The user's theme choice, remembered in localStorage. "system" follows the OS setting live. */
export function useTheme(): [ThemePreference, (p: ThemePreference) => void] {
  const [preference, setPreference] = useState(readPreference);

  useEffect(() => {
    apply(preference);
    try {
      if (preference === "system") localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, preference);
    } catch {
      // Not saved; the choice still applies for this visit.
    }
    if (preference !== "system") return;
    const media = matchMedia(DARK_QUERY);
    const onChange = () => apply("system");
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [preference]);

  return [preference, setPreference];
}
