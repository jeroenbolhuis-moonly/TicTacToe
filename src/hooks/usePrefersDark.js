import { useEffect, useState } from "react";

function getDarkPreference() {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/**
 * Tracks OS / browser color scheme (no manual toggle).
 */
export function usePrefersDark() {
  const [isDark, setIsDark] = useState(getDarkPreference);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => setIsDark(mq.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  return isDark;
}
