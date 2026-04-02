import {
  STARTUP_CURRENCIES,
  STARTUP_STAGES,
  STARTUP_TIMEZONES,
  STARTUP_TYPES,
  type StartupDraft,
} from "@shared/types";

export interface StartupFormProps {
  disabled?: boolean;
  error?: string | null;
  onChange: (next: StartupDraft) => void;
  onSubmit: () => void | Promise<void>;
  value: StartupDraft;
}

export function StartupForm({
  value,
  disabled = false,
  error = null,
  onChange,
  onSubmit,
}: StartupFormProps) {
  return (
    <form
      aria-label="startup form"
      onSubmit={(event) => {
        event.preventDefault();
        void onSubmit();
      }}
      style={{ display: "grid", gap: "0.75rem" }}
    >
      <label htmlFor="startup-name">Startup name</label>
      <input
        disabled={disabled}
        id="startup-name"
        name="name"
        onInput={(event) =>
          onChange({ ...value, name: (event.target as HTMLInputElement).value })
        }
        placeholder="Acme Analytics"
        type="text"
        value={value.name}
      />

      <label htmlFor="startup-type">Startup type</label>
      <select
        disabled={disabled}
        id="startup-type"
        name="type"
        onChange={(event) =>
          onChange({
            ...value,
            type: event.target.value as StartupDraft["type"],
          })
        }
        value={value.type}
      >
        {STARTUP_TYPES.map((type) => (
          <option key={type} value={type}>
            {type}
          </option>
        ))}
      </select>

      <label htmlFor="startup-stage">Stage</label>
      <select
        disabled={disabled}
        id="startup-stage"
        name="stage"
        onChange={(event) =>
          onChange({
            ...value,
            stage: event.target.value as StartupDraft["stage"],
          })
        }
        value={value.stage}
      >
        {STARTUP_STAGES.map((stage) => (
          <option key={stage} value={stage}>
            {stage}
          </option>
        ))}
      </select>

      <label htmlFor="startup-timezone">Timezone</label>
      <select
        disabled={disabled}
        id="startup-timezone"
        name="timezone"
        onChange={(event) =>
          onChange({
            ...value,
            timezone: event.target.value as StartupDraft["timezone"],
          })
        }
        value={value.timezone}
      >
        {STARTUP_TIMEZONES.map((timezone) => (
          <option key={timezone} value={timezone}>
            {timezone}
          </option>
        ))}
      </select>

      <label htmlFor="startup-currency">Currency</label>
      <select
        disabled={disabled}
        id="startup-currency"
        name="currency"
        onChange={(event) =>
          onChange({
            ...value,
            currency: event.target.value as StartupDraft["currency"],
          })
        }
        value={value.currency}
      >
        {STARTUP_CURRENCIES.map((currency) => (
          <option key={currency} value={currency}>
            {currency}
          </option>
        ))}
      </select>

      {error ? <p role="alert">{error}</p> : null}

      <button disabled={disabled} type="submit">
        {disabled ? "Creating startup…" : "Create startup"}
      </button>
    </form>
  );
}
