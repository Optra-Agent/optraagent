import crypto from "node:crypto";
import type { HarmonicDirection, HarmonicHorizon } from "./types";

const ALGORITHM = "aes-256-gcm";

function getEncryptionKey(): Buffer {
  const raw =
    process.env.HARMONIC_SECRET_ENCRYPTION_KEY ??
    process.env.SESSION_SECRET ??
    "optra-harmonic-dev-fallback-key-32b";
  return crypto.createHash("sha256").update(raw).digest();
}

export function encryptSecret(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

export function decryptSecret(ciphertext: string): string {
  const parts = ciphertext.split(":");
  if (parts.length !== 3) {
    throw new Error("Invalid encrypted secret format");
  }
  const [ivHex, tagHex, dataHex] = parts;
  const key = getEncryptionKey();
  const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(dataHex, "hex")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}

export function fingerprintSecret(secret: string): string {
  return crypto.createHash("sha256").update(secret).digest("hex").slice(0, 16);
}

/**
 * Exact Harmonic Registry commitment formula:
 * sha256('registry:v1|SUBJECT|direction|horizon|salt') as 64-char hex.
 */
export function computeCommitmentHash(
  subject: string,
  direction: HarmonicDirection,
  horizon: HarmonicHorizon,
  salt: string,
): string {
  const canonical = `registry:v1|${subject.toUpperCase()}|${direction}|${horizon}|${salt}`;
  return crypto.createHash("sha256").update(canonical).digest("hex");
}

export function generateSalt(): string {
  return crypto.randomBytes(16).toString("hex");
}

export function hashCanonical(value: unknown): string {
  const json = JSON.stringify(value, Object.keys(value as Record<string, unknown>).sort());
  return `sha256:${crypto.createHash("sha256").update(json).digest("hex")}`;
}

