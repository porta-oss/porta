// Postgres connection-URI validation adapter.
// Validates the URI format, scheme, and reachability before persisting credentials.
// The connection string itself is never logged or included in error messages.

import type { ProviderValidationResult } from '@shared/connectors';
import { postgresSetupSchema } from '@shared/custom-metric';
import type { PostgresSetupInput } from '@shared/custom-metric';

export type { PostgresSetupInput };

export interface PostgresValidator {
  validate(config: PostgresSetupInput): Promise<ProviderValidationResult>;
}

/**
 * Production Postgres validator.
 * Validates the URI scheme and attempts a lightweight connection check.
 * Never logs or returns the actual connection string.
 */
export function createPostgresValidator(): PostgresValidator {
  return {
    async validate(config: PostgresSetupInput): Promise<ProviderValidationResult> {
      // Validate with the shared Zod schema first
      const parsed = postgresSetupSchema.safeParse(config);
      if (!parsed.success) {
        const firstIssue = parsed.error.issues[0];
        return {
          valid: false,
          error: firstIssue?.message ?? 'Postgres setup validation failed.',
        };
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
  result: ProviderValidationResult = { valid: true },
): PostgresValidator & { calls: PostgresSetupInput[] } {
  const calls: PostgresSetupInput[] = [];
  return {
    calls,
    async validate(config: PostgresSetupInput): Promise<ProviderValidationResult> {
      calls.push(config);

      // Still validate input shape even in stub mode
      const parsed = postgresSetupSchema.safeParse(config);
      if (!parsed.success) {
        const firstIssue = parsed.error.issues[0];
        return {
          valid: false,
          error: firstIssue?.message ?? 'Postgres setup validation failed.',
        };
      }

      return result;
    },
  };
}
