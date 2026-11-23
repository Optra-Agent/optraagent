"use client";

import { useState } from "react";
import { assetLogoPath } from "@/lib/market/asset-logos";
import { cn } from "@/lib/utils";

/** A calm, deterministic tint per ticker so monograms are distinguishable without implying a brand. */
function monogramHue(symbol: string): number {
  let hash = 0;
  for (const char of symbol) hash = (hash * 31 + char.charCodeAt(0)) % 360;
  return hash;
}

/**
 * Bundled company mark when one has been verified for this ticker, otherwise a ticker monogram. The image comes from this
 * site's own /logos folder, so there is no ticker guessing and no third-party request. Decorative: the row names the asset.
 */
export function AssetLogo({ symbol, size = 36, className }: { symbol: string; size?: number; className?: string }) {
  const [failed, setFailed] = useState(false);
  const path = assetLogoPath(symbol);
  const src = path && !failed ? path : undefined;
  return (
    <span className={cn("asset-logo", className)} data-fallback={src ? "0" : "1"} style={{ width: size, height: size, ...(src ? {} : { ["--logo-hue" as string]: monogramHue(symbol.toUpperCase()) }) }} aria-hidden="true">
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- fixed first-party file, native onError fallback to the monogram
        <img src={src} alt="" width={size} height={size} loading="lazy" decoding="async" onError={() => setFailed(true)} />
      ) : (
        <span className="asset-initials">{symbol.slice(0, 3)}</span>
      )}
    </span>
  );
}
