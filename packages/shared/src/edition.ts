/**
 * Porta edition/runtime contract.
 *
 * `community` — open-source self-host (default).
 * `pro` — licensed features enabled.
 */

export type PortaEdition = "community" | "pro";

export const VALID_EDITIONS = new Set<PortaEdition>(["community", "pro"]);

export const DEFAULT_EDITION: PortaEdition = "community";

export function isValidEdition(value: string): value is PortaEdition {
  return VALID_EDITIONS.has(value as PortaEdition);
}

export function parseEdition(value: string | undefined): PortaEdition {
  if (value === undefined || value === "") {
    return DEFAULT_EDITION;
  }

  const normalized = value.trim().toLowerCase();

  if (!isValidEdition(normalized)) {
    throw new Error(
      `PORTA_EDITION must be one of: ${Array.from(VALID_EDITIONS).join(", ")}. Received: "${value}"`
    );
  }

  return normalized;
}
