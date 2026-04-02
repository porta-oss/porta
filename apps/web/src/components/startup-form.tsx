import {
  STARTUP_CURRENCIES,
  STARTUP_STAGES,
  STARTUP_TIMEZONES,
  STARTUP_TYPES,
  type StartupDraft
} from '@shared/types';

export interface StartupFormProps {
  value: StartupDraft;
  disabled?: boolean;
  error?: string | null;
  onChange: (next: StartupDraft) => void;
  onSubmit: () => void | Promise<void>;
}

export function StartupForm({ value, disabled = false, error = null, onChange, onSubmit }: StartupFormProps) {
  return (
    <form
      aria-label="startup form"
      onSubmit={(event) => {
        event.preventDefault();
        void onSubmit();
      }}
      style={{ display: 'grid', gap: '0.75rem' }}
    >
      <label htmlFor="startup-name">Startup name</label>
      <input
        id="startup-name"
        name="name"
        type="text"
        placeholder="Acme Analytics"
        value={value.name}
        disabled={disabled}
        onInput={(event) => onChange({ ...value, name: (event.target as HTMLInputElement).value })}
      />

      <label htmlFor="startup-type">Startup type</label>
      <select
        id="startup-type"
        name="type"
        value={value.type}
        disabled={disabled}
        onChange={(event) => onChange({ ...value, type: event.target.value as StartupDraft['type'] })}
      >
        {STARTUP_TYPES.map((type) => (
          <option key={type} value={type}>
            {type}
          </option>
        ))}
      </select>

      <label htmlFor="startup-stage">Stage</label>
      <select
        id="startup-stage"
        name="stage"
        value={value.stage}
        disabled={disabled}
        onChange={(event) => onChange({ ...value, stage: event.target.value as StartupDraft['stage'] })}
      >
        {STARTUP_STAGES.map((stage) => (
          <option key={stage} value={stage}>
            {stage}
          </option>
        ))}
      </select>

      <label htmlFor="startup-timezone">Timezone</label>
      <select
        id="startup-timezone"
        name="timezone"
        value={value.timezone}
        disabled={disabled}
        onChange={(event) => onChange({ ...value, timezone: event.target.value as StartupDraft['timezone'] })}
      >
        {STARTUP_TIMEZONES.map((timezone) => (
          <option key={timezone} value={timezone}>
            {timezone}
          </option>
        ))}
      </select>

      <label htmlFor="startup-currency">Currency</label>
      <select
        id="startup-currency"
        name="currency"
        value={value.currency}
        disabled={disabled}
        onChange={(event) => onChange({ ...value, currency: event.target.value as StartupDraft['currency'] })}
      >
        {STARTUP_CURRENCIES.map((currency) => (
          <option key={currency} value={currency}>
            {currency}
          </option>
        ))}
      </select>

      {error ? <p role="alert">{error}</p> : null}

      <button type="submit" disabled={disabled}>
        {disabled ? 'Creating startup…' : 'Create startup'}
      </button>
    </form>
  );
}
