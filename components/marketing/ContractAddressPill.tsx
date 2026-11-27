"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

export const OPTRA_CONTRACT_ADDRESS = "0xc46f6a8149d5a400a230d3cdfc7a3a9abf3150fc";

export function ContractAddressPill() {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(OPTRA_CONTRACT_ADDRESS);
      } else {
        const area = document.createElement("textarea");
        area.value = OPTRA_CONTRACT_ADDRESS;
        area.setAttribute("readonly", "");
        area.style.position = "fixed";
        area.style.opacity = "0";
        document.body.appendChild(area);
        area.select();
        document.execCommand("copy");
        document.body.removeChild(area);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <button
      type="button"
      className="ca-pill"
      data-copied={copied ? "1" : "0"}
      onClick={() => void handleCopy()}
      aria-label={copied ? "Contract address copied" : `Copy contract address ${OPTRA_CONTRACT_ADDRESS}`}
      title="Click to copy contract address"
    >
      <span className="ca-pill-label">CA</span>
      <span className="ca-pill-addr mono">{OPTRA_CONTRACT_ADDRESS}</span>
      <span className="ca-pill-status" aria-live="polite">
        {copied ? (
          <>
            <Check size={13} aria-hidden="true" />
            <span>Copied</span>
          </>
        ) : (
          <Copy size={13} aria-hidden="true" />
        )}
      </span>
    </button>
  );
}
