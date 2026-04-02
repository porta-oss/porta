import type { StartupRecord } from "@shared/types";

export interface StartupListProps {
  error?: string | null;
  onRetry?: () => void | Promise<void>;
  startups: StartupRecord[];
  status: "idle" | "loading" | "refreshing" | "ready" | "error";
  workspaceName: string | null;
}

export function StartupList({
  workspaceName,
  startups,
  status,
  error = null,
  onRetry,
}: StartupListProps) {
  const isBusy = status === "loading" || status === "refreshing";

  return (
    <section
      aria-label="startup list"
      style={{
        display: "grid",
        gap: "0.875rem",
        padding: "1rem",
        border: "1px solid #e5e7eb",
        borderRadius: "1rem",
        background: "#fff",
      }}
    >
      <div>
        <p
          style={{
            margin: 0,
            fontSize: "0.75rem",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "#6b7280",
          }}
        >
          Startup scope
        </p>
        <h2 style={{ margin: "0.35rem 0 0", fontSize: "1.125rem" }}>
          {workspaceName ? `${workspaceName} startups` : "Portfolio navigation"}
        </h2>
      </div>

      {status === "loading" ? (
        <p role="status">
          Loading startup navigation for the active workspace…
        </p>
      ) : null}
      {status === "refreshing" ? (
        <p role="status">
          Refreshing startup navigation for the active workspace…
        </p>
      ) : null}

      {status === "error" ? (
        <div style={{ display: "grid", gap: "0.75rem" }}>
          <p role="alert" style={{ margin: 0, color: "#991b1b" }}>
            {error ?? "The startup navigation could not be loaded."}
          </p>
          <button onClick={() => void onRetry?.()} type="button">
            Retry startup load
          </button>
        </div>
      ) : null}

      {status !== "error" && !workspaceName ? (
        <div style={{ display: "grid", gap: "0.5rem" }}>
          <p style={{ margin: 0 }}>
            The dashboard shell is ready, but startup navigation stays locked
            until a workspace becomes active.
          </p>
          <a href="/app/onboarding">
            Create or select a workspace in onboarding
          </a>
        </div>
      ) : null}

      {status !== "error" &&
      workspaceName &&
      startups.length === 0 &&
      !isBusy ? (
        <div style={{ display: "grid", gap: "0.5rem" }}>
          <p style={{ margin: 0 }}>
            No startups are attached to this workspace yet.
          </p>
          <a href="/app/onboarding">Add the first startup profile</a>
        </div>
      ) : null}

      {startups.length > 0 ? (
        <ul
          style={{
            margin: 0,
            paddingLeft: "1rem",
            display: "grid",
            gap: "0.75rem",
          }}
        >
          {startups.map((startup, index) => (
            <li key={startup.id}>
              <strong>{startup.name}</strong>
              <div style={{ color: "#4b5563" }}>
                {index === 0 ? "Primary startup" : "Startup"} ·{" "}
                {startup.stage.replace("_", " ")} ·{" "}
                {startup.type.replace("_", " ")} · {startup.timezone} ·{" "}
                {startup.currency}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
