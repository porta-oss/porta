// YooKassa credential validation adapter.
// Validates shopId + secretKey by calling the YooKassa /v3/me endpoint with HTTP Basic Auth.
// All errors are redacted — raw credentials never appear in error messages or logs.

import type { ProviderValidationResult } from "@shared/connectors";

export interface YooKassaConfig {
  secretKey: string;
  shopId: string;
}

export interface YooKassaValidator {
  validate(config: YooKassaConfig): Promise<ProviderValidationResult>;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const YOOKASSA_API_BASE = "https://api.yookassa.ru";

function isNonBlank(value: string): boolean {
  return value.trim().length > 0;
}

function validateYooKassaConfig(
  config: YooKassaConfig
): ProviderValidationResult | null {
  if (!isNonBlank(config.shopId)) {
    return { valid: false, error: "YooKassa shop ID is required." };
  }

  if (!isNonBlank(config.secretKey)) {
    return { valid: false, error: "YooKassa secret key is required." };
  }

  return null;
}

function mapYooKassaResponseStatus(status: number): ProviderValidationResult {
  if (status === 200) {
    return { valid: true };
  }

  if (status === 401) {
    return {
      valid: false,
      error: "YooKassa credentials are invalid or have been revoked.",
    };
  }

  if (status === 403) {
    return {
      valid: false,
      error: "YooKassa credentials lack the required permissions.",
    };
  }

  if (status >= 500) {
    return {
      valid: false,
      error: "YooKassa API returned a server error. Try again shortly.",
      retryable: true,
    };
  }

  return {
    valid: false,
    error: `YooKassa validation failed with status ${status}.`,
  };
}

async function requestYooKassaValidation(
  shopId: string,
  secretKey: string,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(`${YOOKASSA_API_BASE}/v3/me`, {
      method: "GET",
      headers: {
        Authorization: `Basic ${btoa(`${shopId}:${secretKey}`)}`,
        Accept: "application/json",
      },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

function isDemoYooKassaConfig(config: YooKassaConfig): boolean {
  return (
    config.shopId.trim() === YOOKASSA_DEMO_SHOP_ID &&
    config.secretKey.trim() === YOOKASSA_DEMO_SECRET_KEY
  );
}

/**
 * Production YooKassa validator that calls the real YooKassa /v3/me endpoint.
 */
export function createYooKassaValidator(options?: {
  timeoutMs?: number;
}): YooKassaValidator {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return {
    async validate(config: YooKassaConfig): Promise<ProviderValidationResult> {
      const inputError = validateYooKassaConfig(config);
      if (inputError) {
        return inputError;
      }

      try {
        const response = await requestYooKassaValidation(
          config.shopId.trim(),
          config.secretKey.trim(),
          timeoutMs
        );
        return mapYooKassaResponseStatus(response.status);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          return {
            valid: false,
            error: "YooKassa validation timed out. Try again.",
            retryable: true,
          };
        }

        console.warn("[yookassa] validation request failed", {
          provider: "yookassa",
          error: err instanceof Error ? err.message : String(err),
        });

        return {
          valid: false,
          error:
            "YooKassa validation request failed. Check network connectivity.",
          retryable: true,
        };
      }
    },
  };
}

/**
 * Stub validator for tests — always returns the configured result.
 */
export function createStubYooKassaValidator(
  result: ProviderValidationResult = { valid: true }
): YooKassaValidator & { calls: YooKassaConfig[] } {
  const calls: YooKassaConfig[] = [];
  return {
    calls,
    async validate(config: YooKassaConfig): Promise<ProviderValidationResult> {
      calls.push(config);

      const inputError = validateYooKassaConfig(config);
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
const YOOKASSA_DEMO_SHOP_ID = "yookassa_proof_shop_001";
const YOOKASSA_DEMO_SECRET_KEY = "yookassa_proof_secret_key";

export function createFounderProofYooKassaValidator(): YooKassaValidator {
  return {
    async validate(config: YooKassaConfig): Promise<ProviderValidationResult> {
      const inputError = validateYooKassaConfig(config);
      if (inputError) {
        return inputError;
      }

      if (isDemoYooKassaConfig(config)) {
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

export { YOOKASSA_DEMO_SECRET_KEY, YOOKASSA_DEMO_SHOP_ID };
