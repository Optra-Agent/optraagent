"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

/** The server already verified the logo. The browser re-checks scheme and host so a bad value can never load. */
const TRUSTED_HOSTS = new Set(["cdn.robinhood.com"]);
export function trustedLogo(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && TRUSTED_HOSTS.has(parsed.hostname) ? parsed.toString() : undefined;
  } catch {
    return undefined;
  }
}

/** Official asset logo, or the ticker's initials when there is none or it fails to load. Decorative: the row names the asset. */
export function AssetLogo({ symbol, logoUrl, size = 36, className }: { symbol: string; logoUrl?: string; size?: number; className?: string }) {
  const [failed, setFailed] = useState(false);
  const src = failed ? undefined : trustedLogo(logoUrl);
  return (
    <span className={cn("asset-logo", className)} data-fallback={src ? "0" : "1"} style={{ width: size, height: size }} aria-hidden="true">
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- remote host is allowlisted above; no image optimizer config is needed
        <img src={src} alt="" width={size} height={size} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
      ) : (
        <span className="asset-initials">{symbol.slice(0, 3)}</span>
      )}
    </span>
  );
}
