// Sentry credential validation adapter.
// Validates authToken + organization + project by calling the Sentry project endpoint with Bearer auth.
// All errors are redacted — raw credentials never appear in error messages or logs.

import type { ProviderValidationResult } from "@shared/connectors";

export interface SentryConfig {
  authToken: string;
  organization: string;
  project: string;
}

export interface SentryValidator {
  validate(config: SentryConfig): Promise<ProviderValidationResult>;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const SENTRY_API_BASE = "https://sentry.io";

function isNonBlank(value: string): boolean {
  return value.trim().length > 0;
}

function validateSentryConfig(
  config: SentryConfig
): ProviderValidationResult | null {
  if (!isNonBlank(config.authToken)) {
    return { valid: false, error: "Sentry auth token is required." };
  }

  if (!isNonBlank(config.organization)) {
    return { valid: false, error: "Sentry organization slug is required." };
  }

  if (!isNonBlank(config.project)) {
    return { valid: false, error: "Sentry project slug is required." };
  }

  return null;
}

function mapSentryResponseStatus(status: number): ProviderValidationResult {
  if (status === 200) {
    return { valid: true };
  }

  if (status === 401) {
    return {
      valid: false,
      error: "Sentry auth token is invalid or has been revoked.",
    };
  }

  if (status === 403) {
    return {
      valid: false,
      error: "Sentry auth token lacks the required permissions.",
    };
  }

  if (status === 404) {
    return {
      valid: false,
      error:
        "Sentry organization or project not found. Verify the slugs are correct.",
    };
  }

  if (status >= 500) {
    return {
      valid: false,
      error: "Sentry API returned a server error. Try again shortly.",
      retryable: true,
    };
  }

  return {
    valid: false,
    error: `Sentry validation failed with status ${status}.`,
  };
}

async function requestSentryValidation(
  authToken: string,
  organization: string,
  project: string,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(
      `${SENTRY_API_BASE}/api/0/projects/${organization}/${project}/`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${authToken}`,
          Accept: "application/json",
        },
        signal: controller.signal,
      }
    );
  } finally {
    clearTimeout(timer);
  }
}

function isDemoSentryConfig(config: SentryConfig): boolean {
  return (
    config.authToken.trim() === SENTRY_DEMO_AUTH_TOKEN &&
    config.organization.trim() === SENTRY_DEMO_ORGANIZATION &&
    config.project.trim() === SENTRY_DEMO_PROJECT
  );
}

/**
 * Production Sentry validator that calls the real Sentry project endpoint.
 */
export function createSentryValidator(options?: {
  timeoutMs?: number;
}): SentryValidator {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return {
    async validate(config: SentryConfig): Promise<ProviderValidationResult> {
      const inputError = validateSentryConfig(config);
      if (inputError) {
        return inputError;
      }

      try {
        const response = await requestSentryValidation(
          config.authToken.trim(),
          config.organization.trim(),
          config.project.trim(),
          timeoutMs
        );
        return mapSentryResponseStatus(response.status);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          return {
            valid: false,
            error: "Sentry validation timed out. Try again.",
            retryable: true,
          };
        }

        console.warn("[sentry] validation request failed", {
          provider: "sentry",
          error: err instanceof Error ? err.message : String(err),
        });

        return {
          valid: false,
          error:
            "Sentry validation request failed. Check network connectivity.",
          retryable: true,
        };
      }
    },
  };
}

/**
 * Stub validator for tests — always returns the configured result.
 */
export function createStubSentryValidator(
  result: ProviderValidationResult = { valid: true }
): SentryValidator & { calls: SentryConfig[] } {
  const calls: SentryConfig[] = [];
  return {
    calls,
    async validate(config: SentryConfig): Promise<ProviderValidationResult> {
      calls.push(config);

      const inputError = validateSentryConfig(config);
      if (inputError) {
        return inputError;
      }

      return result;
    },
  };
}

/**
 * Deterministic demo credentials accepted during founder-proof mode.
 * Shape validation is still enforced — only the live HTTP call is skipped.
 */
const SENTRY_DEMO_AUTH_TOKEN = "sentry_proof_token_001";
const SENTRY_DEMO_ORGANIZATION = "sentry_proof_org";
const SENTRY_DEMO_PROJECT = "sentry_proof_project";

export function createFounderProofSentryValidator(): SentryValidator {
  return {
    async validate(config: SentryConfig): Promise<ProviderValidationResult> {
      const inputError = validateSentryConfig(config);
      if (inputError) {
        return inputError;
      }

      if (isDemoSentryConfig(config)) {
        return { valid: true };
      }

      return {
        valid: false,
        error:
          "Founder-proof mode requires the deterministic demo credentials. Use the documented proof values.",
      };
    },
  };
}

export {
  SENTRY_DEMO_AUTH_TOKEN,
  SENTRY_DEMO_ORGANIZATION,
  SENTRY_DEMO_PROJECT,
};
