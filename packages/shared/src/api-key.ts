// API key contracts shared across API and UI.

import { z } from "zod";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const API_KEY_SCOPES = ["read", "write"] as const;
export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

export const apiKeyCreateInputSchema = z.object({
  name: z.string().min(1).max(100),
  scope: z.enum(API_KEY_SCOPES),
});

export type ApiKeyCreateInput = z.infer<typeof apiKeyCreateInputSchema>;

// ---------------------------------------------------------------------------
// Summary interfaces — returned to the UI, never includes key_hash
// ---------------------------------------------------------------------------

export interface ApiKeySummary {
  createdAt: string;
  id: string;
  keyPrefix: string;
  lastUsedAt: string | null;
  name: string;
  revokedAt: string | null;
  scope: ApiKeyScope;
  workspaceId: string;
}

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

export function isApiKeyScope(value: string): value is ApiKeyScope {
  return API_KEY_SCOPES.includes(value as ApiKeyScope);
}
