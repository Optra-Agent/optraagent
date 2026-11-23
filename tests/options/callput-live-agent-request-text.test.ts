import { describe, expect, it } from "vitest";
import { LIVE_AGENT_REQUEST_STATES } from "../../lib/venue/callput-live-agent-store";
import { describeLiveRequest } from "../../lib/venue/callput-live-agent-request-text";

describe("Live Agent request wording", () => {
  it("covers every ledger state and never calls anything but an on-chain Executed request a fill", () => {
    for (const state of LIVE_AGENT_REQUEST_STATES) {
      const view = describeLiveRequest(state);
      expect(view.title, state).not.toBe(state);
      expect(view.meaning.length, state).toBeGreaterThan(10);
    }
    for (const state of ["reserved", "submitted", "pending"]) expect(describeLiveRequest(state).meaning).toMatch(/not (a fill|filled|been sent|a position)|has not been sent/i);
    expect(describeLiveRequest("executed").tone).toBe("ok");
  });

  it("gives a recovery action for exactly the states that halt the agent, and tells the owner not to retry blindly", () => {
    expect(describeLiveRequest("stale").recovery).toContain("request tracker");
    expect(describeLiveRequest("unknown").recovery).toContain("explorer");
    expect(describeLiveRequest("unknown").meaning).toContain("never retried blindly");
    expect(describeLiveRequest("stale").tone).toBe("problem");
    expect(describeLiveRequest("unknown").tone).toBe("problem");
    expect(describeLiveRequest("pending").recovery).toBeNull();
  });

  it("handles an unrecognized state without crashing", () => {
    expect(describeLiveRequest("mystery").recovery).toContain("stop the agent");
  });
});
