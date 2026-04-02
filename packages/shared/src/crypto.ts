// AES-256-GCM encryption helpers for connector credentials.
// Works in both Bun and Node via the `node:crypto` module.
// Decrypted values never appear in error messages or logs.

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm" as const;
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const KEY_BYTES = 32;

export interface EncryptedBlob {
  /** Hex-encoded 16-byte GCM authentication tag. */
  authTag: string;
  /** Hex-encoded ciphertext. */
  ciphertext: string;
  /** Hex-encoded 12-byte IV. */
  iv: string;
}

/**
 * Validate and return a 32-byte Buffer from a 64-character hex string.
 * Throws a redacted error on invalid input — never reveals the key.
 */
export function parseEncryptionKey(hex: string): Buffer {
  if (typeof hex !== "string") {
    throw new Error("CONNECTOR_ENCRYPTION_KEY must be a hex string.");
  }

  const trimmed = hex.trim();

  if (trimmed.length !== KEY_BYTES * 2) {
    throw new Error(
      `CONNECTOR_ENCRYPTION_KEY must be exactly ${KEY_BYTES * 2} hex characters (${KEY_BYTES} bytes). Received length: ${trimmed.length}.`
    );
  }

  if (!/^[0-9a-fA-F]+$/.test(trimmed)) {
    throw new Error("CONNECTOR_ENCRYPTION_KEY contains non-hex characters.");
  }

  return Buffer.from(trimmed, "hex");
}

/**
 * Encrypt a plaintext string using AES-256-GCM.
 * Returns an `EncryptedBlob` with separate IV and auth-tag fields.
 */
export function encryptConnectorConfig(
  plaintext: string,
  key: Buffer
): EncryptedBlob {
  if (key.length !== KEY_BYTES) {
    throw new Error(`Encryption key must be ${KEY_BYTES} bytes.`);
  }

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return {
    ciphertext: encrypted.toString("hex"),
    iv: iv.toString("hex"),
    authTag: authTag.toString("hex"),
  };
}

/**
 * Decrypt an `EncryptedBlob` back to the original plaintext.
 * Throws on tampered ciphertext, IV, or auth-tag — errors never include plaintext.
 */
export function decryptConnectorConfig(
  blob: EncryptedBlob,
  key: Buffer
): string {
  if (key.length !== KEY_BYTES) {
    throw new Error(`Encryption key must be ${KEY_BYTES} bytes.`);
  }

  let iv: Buffer;
  let authTag: Buffer;
  let ciphertext: Buffer;

  try {
    iv = Buffer.from(blob.iv, "hex");
    authTag = Buffer.from(blob.authTag, "hex");
    ciphertext = Buffer.from(blob.ciphertext, "hex");
  } catch {
    throw new Error("Decryption failed: malformed encrypted blob fields.");
  }

  if (iv.length !== IV_BYTES) {
    throw new Error(
      `Decryption failed: IV must be ${IV_BYTES} bytes, received ${iv.length}.`
    );
  }

  if (authTag.length !== AUTH_TAG_BYTES) {
    throw new Error(
      `Decryption failed: auth tag must be ${AUTH_TAG_BYTES} bytes, received ${authTag.length}.`
    );
  }

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  try {
    const decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);
    return decrypted.toString("utf8");
  } catch {
    throw new Error(
      "Decryption failed: authentication tag mismatch or corrupted ciphertext."
    );
  }
}
