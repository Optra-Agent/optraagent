"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

/** Build only LogoAPI's fixed-origin ticker URL; `fallback=none` keeps synthetic tiles out of the Market list. */
export function tickerLogoUrl(symbol: string): string | undefined {
  const ticker = symbol.trim().toUpperCase();
  if (!/^[A-Z0-9.]{1,16}$/.test(ticker)) return undefined;
  return `https://logoapi.sh/ticker/${encodeURIComponent(ticker)}.svg?shape=square&fallback=none`;
}

/** LogoAPI ticker logo, or ticker initials when none is available or loading fails. Decorative: the row names the asset. */
export function AssetLogo({ symbol, size = 36, className }: { symbol: string; size?: number; className?: string }) {
  const [failed, setFailed] = useState<readonly string[]>([]);
  const logo = tickerLogoUrl(symbol);
  const src = logo && !failed.includes(logo) ? logo : undefined;
  return (
    <span className={cn("asset-logo", className)} data-fallback={src ? "0" : "1"} style={{ width: size, height: size }} aria-hidden="true">
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- fixed LogoAPI origin, validated ticker, native SVG and onError fallback
        <img src={src} alt="" width={size} height={size} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed((list) => [...list, src])} />
      ) : (
        <span className="asset-initials">{symbol.slice(0, 3)}</span>
      )}
    </span>
  );
}
