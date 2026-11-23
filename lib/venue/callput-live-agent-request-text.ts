/**
 * Plain-language meaning and recovery for each request state in the Live Agent ledger. The wording follows the worker's
 * contract: only `executed` means the venue's own request read Executed, and `stale` or `unknown` halt the agent until
 * the chain proves what happened. Nothing here changes state; it only tells the owner what to check.
 */
export type LiveRequestView = { title: string; meaning: string; recovery: string | null; tone: "ok" | "waiting" | "problem" };

const VIEWS: Record<string, LiveRequestView> = {
  reserved: { title: "Reserved", meaning: "The order was reserved in the ledger but has not been sent to the chain.", recovery: null, tone: "waiting" },
  submitted: { title: "Sent", meaning: "The transaction was broadcast. The venue's request key has not been read back yet, so this is not a fill.", recovery: "It is reconciled on the next scheduled pass. You can look the transaction up on the explorer.", tone: "waiting" },
  pending: { title: "Pending", meaning: "The venue accepted the request and the keeper has not filled it. A pending request is not a position.", recovery: null, tone: "waiting" },
  executed: { title: "Executed on chain", meaning: "The venue's request reads Executed. Your wallet's option-token balance is the proof of ownership.", recovery: null, tone: "ok" },
  cancelled: { title: "Cancelled by the venue", meaning: "The venue cancelled the request. There is no fill and no position.", recovery: null, tone: "ok" },
  stale: { title: "Stale: agent halted", meaning: "The request stayed pending past the venue's window, so new orders are blocked.", recovery: "Paste the request key into the request tracker below and confirm on chain whether it was cancelled or executed. The agent stays stopped until that is proven.", tone: "problem" },
  unknown: { title: "Unknown: agent halted", meaning: "The outcome after broadcast could not be proven (for example an RPC failure). The order may have landed, so it is never retried blindly.", recovery: "Look the transaction up on the explorer and read its request key in the request tracker below. The agent stays stopped until the chain shows the outcome.", tone: "problem" },
  closed: { title: "Closed", meaning: "The position from this request has been closed or settled.", recovery: null, tone: "ok" },
};

export function describeLiveRequest(state: string): LiveRequestView {
  return VIEWS[state] ?? { title: state, meaning: "This request is in a state this screen does not recognize.", recovery: "Reload the page. If it persists, stop the agent and check the request on chain.", tone: "problem" };
}
