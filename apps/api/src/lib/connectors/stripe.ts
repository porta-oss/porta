// Stripe credential validation adapter.
// Validates a Stripe secret key by calling the Stripe balance endpoint.
// All errors are redacted — the raw key never appears in error messages or logs.

import type { ProviderValidationResult } from "./posthog";

export interface StripeConfig {
  secretKey: string;
}

export interface StripeValidator {
  validate(config: StripeConfig): Promise<ProviderValidationResult>;
}

const DEFAULT_TIMEOUT_MS = 8000;
const STRIPE_API_BASE = "https://api.stripe.com";
const STRIPE_KEY_PATTERN = /^(sk_test_|sk_live_|rk_test_|rk_live_)/;

function isValidStripeKeyFormat(key: string): boolean {
  return STRIPE_KEY_PATTERN.test(key.trim());
}

/**
 * Production Stripe validator that calls the real Stripe balance endpoint.
 */
export function createStripeValidator(options?: {
  timeoutMs?: number;
}): StripeValidator {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return {
    async validate(config: StripeConfig): Promise<ProviderValidationResult> {
      const key = config.secretKey.trim();

      if (!key) {
        return { valid: false, error: "Stripe secret key is required." };
      }

      if (!isValidStripeKeyFormat(key)) {
        return {
          valid: false,
          error:
            "Stripe key format is invalid. Keys must start with sk_test_, sk_live_, rk_test_, or rk_live_.",
        };
      }

      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);

        const response = await fetch(`${STRIPE_API_BASE}/v1/balance`, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${key}`,
            Accept: "application/json",
          },
          signal: controller.signal,
        });

        clearTimeout(timer);

        if (response.status === 200) {
          return { valid: true };
        }

        if (response.status === 401) {
          return {
            valid: false,
            error: "Stripe secret key is invalid or has been revoked.",
          };
        }

        if (response.status === 403) {
          return {
            valid: false,
            error: "Stripe key lacks the required permissions.",
          };
        }

        if (response.status >= 500) {
          return {
            valid: false,
            error: "Stripe API returned a server error. Try again shortly.",
            retryable: true,
          };
        }

        return {
          valid: false,
          error: `Stripe validation failed with status ${response.status}.`,
        };
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          return {
            valid: false,
            error: "Stripe validation timed out. Try again.",
            retryable: true,
          };
        }

        console.warn("[stripe] validation request failed", {
          provider: "stripe",
          error: err instanceof Error ? err.message : String(err),
        });

        return {
          valid: false,
          error:
            "Stripe validation request failed. Check network connectivity.",
          retryable: true,
        };
      }
    },
  };
}

/**
 * Stub validator for tests — always returns the configured result.
 */
export function createStubStripeValidator(
  result: ProviderValidationResult = { valid: true }
): StripeValidator & { calls: StripeConfig[] } {
  const calls: StripeConfig[] = [];
  return {
    calls,
    async validate(config: StripeConfig): Promise<ProviderValidationResult> {
      calls.push(config);

      const key = config.secretKey.trim();
      if (!key) {
        return { valid: false, error: "Stripe secret key is required." };
      }
      if (!isValidStripeKeyFormat(key)) {
        return {
          valid: false,
          error:
            "Stripe key format is invalid. Keys must start with sk_test_, sk_live_, rk_test_, or rk_live_.",
        };
      }

      return result;
    },
  };
}

/**
 * Deterministic demo credentials accepted during founder-proof mode.
 * Key format validation is still enforced — only the live HTTP call is skipped.
 */
const STRIPE_DEMO_SECRET_KEY = "sk_test_founder_proof_demo_key";

export function createFounderProofStripeValidator(): StripeValidator {
  return {
    async validate(config: StripeConfig): Promise<ProviderValidationResult> {
      const key = config.secretKey.trim();

      if (!key) {
        return { valid: false, error: "Stripe secret key is required." };
      }

      if (!isValidStripeKeyFormat(key)) {
        return {
          valid: false,
          error:
            "Stripe key format is invalid. Keys must start with sk_test_, sk_live_, rk_test_, or rk_live_.",
        };
      }

      // Accept only the deterministic demo key
      if (key === STRIPE_DEMO_SECRET_KEY) {
        return { valid: true };
      }

      return {
        valid: false,
        error:
          "Founder-proof mode requires the deterministic demo secret key. Use the documented proof value.",
      };
    },
  };
}

export { STRIPE_DEMO_SECRET_KEY };
