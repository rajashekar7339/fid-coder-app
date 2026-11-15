import { useEffect, useState } from "react";

function secondsLeft(iso: string): number {
  const expires = Date.parse(iso);
  if (!Number.isFinite(expires)) return 0;
  return Math.max(0, Math.ceil((expires - Date.now()) / 1000));
}

export function formatSeconds(seconds: number): string {
  return seconds > 0 ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}` : "now";
}

export function useCountdown(expiresAt: string): number {
  const [seconds, setSeconds] = useState(() => secondsLeft(expiresAt));
  useEffect(() => {
    setSeconds(secondsLeft(expiresAt));
    const timer = window.setInterval(() => setSeconds(secondsLeft(expiresAt)), 1000);
    return () => window.clearInterval(timer);
  }, [expiresAt]);
  return seconds;
}
