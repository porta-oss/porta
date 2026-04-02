import type { FunnelStageRow } from '@shared/startup-health';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StartupFunnelPanelProps {
  stages: FunnelStageRow[];
  muted?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatFunnelValue(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
}

function computeConversion(current: number, previous: number): string | null {
  if (previous === 0) return null;
  const pct = (current / previous) * 100;
  return `${pct.toFixed(1)}%`;
}

/** Width percentage relative to the first (largest) stage. */
function barWidthPct(value: number, maxValue: number): number {
  if (maxValue === 0) return 100;
  return Math.max(4, (value / maxValue) * 100);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function StartupFunnelPanel({ stages, muted = false }: StartupFunnelPanelProps) {
  const sorted = [...stages].sort((a, b) => a.position - b.position);
  const maxValue = sorted[0]?.value ?? 0;

  return (
    <section
      aria-label="funnel"
      style={{
        display: 'grid',
        gap: '0.5rem',
        padding: '1rem',
        border: '1px solid #e5e7eb',
        borderRadius: '0.75rem',
        background: '#fff',
      }}
    >
      <h3 style={{ margin: 0, fontSize: '0.85rem', fontWeight: 600, color: '#374151' }}>
        Acquisition Funnel
      </h3>

      {sorted.map((stage, idx) => {
        const prev = idx > 0 ? sorted[idx - 1] : null;
        const conversion = prev ? computeConversion(stage.value, prev.value) : null;

        return (
          <div
            key={stage.stage}
            aria-label={stage.label}
            style={{ display: 'grid', gap: '0.2rem' }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <span style={{ fontSize: '0.8rem', fontWeight: 500, color: '#374151' }}>
                {stage.label}
              </span>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'baseline' }}>
                <span
                  data-testid={`funnel-${stage.stage}`}
                  style={{
                    fontSize: '0.85rem',
                    fontWeight: 600,
                    fontVariantNumeric: 'tabular-nums',
                    color: muted ? '#9ca3af' : '#111827',
                  }}
                >
                  {formatFunnelValue(stage.value)}
                </span>
                {conversion ? (
                  <span style={{ fontSize: '0.7rem', color: '#6b7280' }}>
                    ({conversion})
                  </span>
                ) : null}
              </div>
            </div>
            <div
              style={{
                height: '6px',
                borderRadius: '3px',
                background: '#f3f4f6',
                overflow: 'hidden',
              }}
            >
              <div
                role="meter"
                aria-valuenow={stage.value}
                aria-valuemin={0}
                aria-valuemax={maxValue}
                aria-label={`${stage.label} bar`}
                style={{
                  width: `${String(barWidthPct(stage.value, maxValue))}%`,
                  height: '100%',
                  borderRadius: '3px',
                  background: muted ? '#d1d5db' : '#6366f1',
                  transition: 'width 0.3s ease',
                }}
              />
            </div>
          </div>
        );
      })}
    </section>
  );
}
