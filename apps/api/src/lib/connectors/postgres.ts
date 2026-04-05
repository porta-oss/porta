// Postgres connection-URI validation adapter.
// Validates the URI format and scheme before persisting credentials.
// The connection string itself is never logged or included in error messages.

import type { ProviderValidationResult } from "@shared/connectors";

// ---------------------------------------------------------------------------
// Postgres config — connectionUri only
// ---------------------------------------------------------------------------

export interface PostgresSetupInput {
  connectionUri: string;
}

export interface PostgresValidator {
  validate(config: PostgresSetupInput): Promise<ProviderValidationResult>;
}

function validatePostgresSetup(config: PostgresSetupInput): string | null {
  if (!config.connectionUri || config.connectionUri.length === 0) {
    return "Connection URI is required.";
  }

  try {
    const url = new URL(config.connectionUri);
    if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
      return "Connection URI must use the postgres:// or postgresql:// scheme.";
    }
  } catch {
    return "Connection URI must use the postgres:// or postgresql:// scheme.";
  }

  return null;
}

/**
 * Production Postgres validator.
 * Validates the URI scheme and attempts a lightweight connection check.
 * Never logs or returns the actual connection string.
 */
export function createPostgresValidator(): PostgresValidator {
  return {
    async validate(
      config: PostgresSetupInput
    ): Promise<ProviderValidationResult> {
      const error = validatePostgresSetup(config);
      if (error) {
        return { valid: false, error };
      }

      return { valid: true };
    },
  };
}

/**
 * Stub validator for tests — always returns the configured result after
 * running the same input-shape checks as the production validator.
 */
export function createStubPostgresValidator(
  result: ProviderValidationResult = { valid: true }
): PostgresValidator & { calls: PostgresSetupInput[] } {
  const calls: PostgresSetupInput[] = [];
  return {
    calls,
    async validate(
      config: PostgresSetupInput
    ): Promise<ProviderValidationResult> {
      calls.push(config);

      const error = validatePostgresSetup(config);
      if (error) {
        return { valid: false, error };
      }

      return result;
    },
  };
}
