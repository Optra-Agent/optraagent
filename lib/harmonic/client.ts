import type {
  FileExpectationInput,
  FileExpectationResult,
  HarmonicAgentClient,
  RegisterAgentInput,
  RegisterAgentResult,
  RegistryLookupInput,
  RegistryRecord,
  RevealInput,
  RevealResult,
  SealInput,
  SealResult,
  VerificationRequestInput,
  VerificationRequestResult,
} from "./types";

const DEFAULT_MCP_URL = "https://harmonicagent.solutions/mcp/registry";
const DEFAULT_BASE_URL = "https://harmonicagent.solutions";

export class HarmonicClientError extends Error {
  constructor(
    message: string,
    public readonly code: string = "HARMONIC_REQUEST_FAILED",
  ) {
    super(message);
    this.name = "HarmonicClientError";
  }
}

export class McpHarmonicAgentClient implements HarmonicAgentClient {
  private readonly mcpUrl: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(options?: { mcpUrl?: string; baseUrl?: string; timeoutMs?: number }) {
    this.mcpUrl = options?.mcpUrl ?? process.env.HARMONIC_MCP_URL ?? DEFAULT_MCP_URL;
    this.baseUrl = options?.baseUrl ?? process.env.HARMONIC_BASE_URL ?? DEFAULT_BASE_URL;
    this.timeoutMs = options?.timeoutMs ?? 12_000;
  }

  private async callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<{ text: string; structured?: Record<string, unknown> }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await fetch(this.mcpUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: Date.now(),
          method: "tools/call",
          params: { name, arguments: args },
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        throw new HarmonicClientError(
          `Harmonic MCP HTTP ${res.status}: ${res.statusText}`,
          `HTTP_${res.status}`,
        );
      }

      const payload = (await res.json()) as {
        error?: { message?: string };
        result?: {
          isError?: boolean;
          content?: Array<{ type: string; text?: string }>;
          structuredContent?: Record<string, unknown>;
        };
      };

      if (payload.error) {
        throw new HarmonicClientError(
          payload.error.message ?? "Harmonic MCP JSON-RPC error",
          "MCP_RPC_ERROR",
        );
      }

      const result = payload.result;
      const text = result?.content?.find((c) => c.type === "text")?.text ?? "";

      if (result?.isError) {
        throw new HarmonicClientError(text || `Harmonic tool ${name} failed`, "MCP_TOOL_ERROR");
      }

      let parsed: Record<string, unknown> | undefined = result?.structuredContent;
      if (!parsed && text.trim().startsWith("{")) {
        try {
          parsed = JSON.parse(text) as Record<string, unknown>;
        } catch {
          // plain text response
        }
      }

      return { text, structured: parsed };
    } catch (err) {
      if (err instanceof HarmonicClientError) throw err;
      throw new HarmonicClientError(
        err instanceof Error ? err.message : "Harmonic MCP request failed",
        "NETWORK_ERROR",
      );
    } finally {
      clearTimeout(timer);
    }
  }

  async registerAgent(input: RegisterAgentInput): Promise<RegisterAgentResult> {
    const args: Record<string, unknown> = {
      name: input.name.slice(0, 40),
      kind: input.kind ?? "mcp",
    };
    if (input.url) args.url = input.url.slice(0, 120);

    const { text, structured } = await this.callTool("registry_register", args);

    const secretMatch = text.match(/ag_[0-9a-f]{48}/);
    const idMatch =
      (structured?.id as string | undefined) ??
      (structured?.agent_id as string | undefined) ??
      text.match(/\b(a-[a-zA-Z0-9_-]+|agent_[a-zA-Z0-9_-]+)\b/)?.[1];
    const secret = (structured?.secret as string | undefined) ?? secretMatch?.[0];

    if (!secret) {
      throw new HarmonicClientError(
        "Harmonic registry_register did not return a secret",
        "MISSING_SECRET",
      );
    }

    const registryId = idMatch ?? `harmonic-${input.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
    return {
      harmonicRegistryId: registryId,
      harmonicIdentity: input.name,
      secret,
      externalUrl: `${this.baseUrl}/#/registry`,
      raw: structured ?? { text },
    };
  }

  async fileExpectation(input: FileExpectationInput): Promise<FileExpectationResult> {
    const args: Record<string, unknown> = {
      subject: input.subject.toUpperCase(),
      direction: input.direction,
      horizon: input.horizon ?? "1d",
      secret: input.secret,
    };
    if (input.note) args.note = input.note.slice(0, 140);

    const { text, structured } = await this.callTool("registry_file", args);
    const refId =
      (structured?.id as string | undefined) ??
      text.match(/\b(f-[a-zA-Z0-9_-]+)\b/)?.[1];

    if (!refId) {
      throw new HarmonicClientError(
        "Harmonic registry_file did not return a filing ID",
        "MISSING_FILING_ID",
      );
    }

    return {
      harmonicReference: refId,
      externalUrl: `${this.baseUrl}/#/registry`,
      status: "FILED",
      raw: structured ?? { text },
    };
  }

  async seal(input: SealInput): Promise<SealResult> {
    const { text, structured } = await this.callTool("registry_seal", {
      commitment: input.commitment,
      horizon: input.horizon ?? "1d",
      secret: input.secret,
    });

    const refId =
      (structured?.id as string | undefined) ??
      text.match(/\b(s-[a-zA-Z0-9_-]+)\b/)?.[1];

    if (!refId) {
      throw new HarmonicClientError(
        "Harmonic registry_seal did not return a seal ID",
        "MISSING_SEAL_ID",
      );
    }

    return {
      harmonicReference: refId,
      externalUrl: `${this.baseUrl}/#/registry`,
      status: "SEALED",
      raw: structured ?? { text },
    };
  }

  async reveal(input: RevealInput): Promise<RevealResult> {
    const { text, structured } = await this.callTool("registry_reveal", {
      id: input.id,
      subject: input.subject.toUpperCase(),
      direction: input.direction,
      salt: input.salt,
      secret: input.secret,
    });

    return {
      harmonicReference: input.id,
      externalUrl: `${this.baseUrl}/#/registry`,
      status: "REVEALED",
      raw: structured ?? { text },
    };
  }

  async getRegistryRecord(input: RegistryLookupInput): Promise<RegistryRecord> {
    const { text, structured } = await this.callTool("registry_filing", {
      id: input.id,
    });

    return {
      id: input.id,
      status: (structured?.status as string | undefined) ?? "UNKNOWN",
      raw: structured ?? { text },
    };
  }

  async requestVerification(
    input: VerificationRequestInput,
  ): Promise<VerificationRequestResult> {
    const args: Record<string, unknown> = { address: input.address };
    if (input.from) args.from = input.from;

    const { text, structured } = await this.callTool("verify_request", args);
    const refId =
      (structured?.id as string | undefined) ??
      (structured?.request_id as string | undefined) ??
      input.address;

    return {
      externalReference: refId,
      status: "PENDING",
      raw: structured ?? { text },
    };
  }
}

