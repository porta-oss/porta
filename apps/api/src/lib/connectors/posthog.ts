// PostHog credential validation adapter.
// Validates API key and project ID against the PostHog API before persisting credentials.
// All errors are mapped to structured validation results — no raw responses leak.

import type { ProviderValidationResult } from "@shared/connectors";

export type { ProviderValidationResult };

export interface PostHogConfig {
  apiKey: string;
  host: string;
  projectId: string;
}

export interface PostHogValidator {
  validate(config: PostHogConfig): Promise<ProviderValidationResult>;
}

const DEFAULT_TIMEOUT_MS = 8000;
const POSTHOG_HOST_PATTERN = /^https?:\/\/.+/;

function isValidPostHogHost(host: string): boolean {
  return POSTHOG_HOST_PATTERN.test(host);
}

function isNonBlank(value: string): boolean {
  return value.trim().length > 0;
}

function validatePostHogConfig(
  config: PostHogConfig
): ProviderValidationResult | null {
  if (!isNonBlank(config.apiKey)) {
    return { valid: false, error: "PostHog API key is required." };
  }

  if (!isNonBlank(config.projectId)) {
    return { valid: false, error: "PostHog project ID is required." };
  }

  if (!isValidPostHogHost(config.host)) {
    return {
      valid: false,
      error: "PostHog host must be a valid URL (e.g. https://app.posthog.com).",
    };
  }

  return null;
}

function createProjectUrl(config: PostHogConfig): string {
  const baseUrl = config.host.replace(/\/+$/, "");
  return `${baseUrl}/api/projects/${encodeURIComponent(config.projectId)}/`;
}

function mapPostHogResponseStatus(status: number): ProviderValidationResult {
  if (status === 200) {
    return { valid: true };
  }

  if (status === 401 || status === 403) {
    return {
      valid: false,
      error:
        "PostHog API key is invalid or lacks access to the specified project.",
    };
  }

  if (status === 404) {
    return {
      valid: false,
      error: "PostHog project not found. Verify the project ID and host.",
    };
  }

  if (status >= 500) {
    return {
      valid: false,
      error: "PostHog API returned a server error. Try again shortly.",
      retryable: true,
    };
  }

  return {
    valid: false,
    error: `PostHog validation failed with status ${status}.`,
  };
}

async function requestProjectValidation(
  url: string,
  apiKey: string,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

function isDemoPostHogConfig(config: PostHogConfig): boolean {
  return (
    config.apiKey === POSTHOG_DEMO_API_KEY &&
    config.projectId === POSTHOG_DEMO_PROJECT_ID &&
    config.host === POSTHOG_DEMO_HOST
  );
}

/**
 * Production PostHog validator that calls the real PostHog API.
 */
export function createPostHogValidator(options?: {
  timeoutMs?: number;
}): PostHogValidator {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return {
    async validate(config: PostHogConfig): Promise<ProviderValidationResult> {
      const inputError = validatePostHogConfig(config);
      if (inputError) {
        return inputError;
      }

      const url = createProjectUrl(config);

      try {
        const response = await requestProjectValidation(
          url,
          config.apiKey,
          timeoutMs
        );
        return mapPostHogResponseStatus(response.status);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          return {
            valid: false,
            error:
              "PostHog validation timed out. Check the host URL and try again.",
            retryable: true,
          };
        }

        console.warn("[posthog] validation request failed", {
          provider: "posthog",
          error: err instanceof Error ? err.message : String(err),
        });

        return {
          valid: false,
          error:
            "PostHog validation request failed. Check the host URL and network connectivity.",
          retryable: true,
        };
      }
    },
  };
}

/**
 * Stub validator for tests — always returns the configured result.
 */
export function createStubPostHogValidator(
  result: ProviderValidationResult = { valid: true }
): PostHogValidator & { calls: PostHogConfig[] } {
  const calls: PostHogConfig[] = [];
  return {
    calls,
    async validate(config: PostHogConfig): Promise<ProviderValidationResult> {
      calls.push(config);

      const inputError = validatePostHogConfig(config);
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
const POSTHOG_DEMO_API_KEY = "phx_founder_proof_demo_key";
const POSTHOG_DEMO_PROJECT_ID = "proof-project-1";
const POSTHOG_DEMO_HOST = "https://proof.posthog.local";

export function createFounderProofPostHogValidator(): PostHogValidator {
  return {
    async validate(config: PostHogConfig): Promise<ProviderValidationResult> {
      const inputError = validatePostHogConfig(config);
      if (inputError) {
        return inputError;
      }

      if (isDemoPostHogConfig(config)) {
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

export { POSTHOG_DEMO_API_KEY, POSTHOG_DEMO_HOST, POSTHOG_DEMO_PROJECT_ID };
