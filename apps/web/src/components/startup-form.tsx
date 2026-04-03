import {
  STARTUP_CURRENCIES,
  STARTUP_STAGES,
  STARTUP_TIMEZONES,
  STARTUP_TYPES,
  type StartupDraft,
} from "@shared/types";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export interface StartupFormProps {
  disabled?: boolean;
  error?: string | null;
  onChange: (next: StartupDraft) => void;
  onSubmit: (name: string) => void | Promise<void>;
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
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        void onSubmit(String(formData.get("name") ?? ""));
      }}
    >
      <div className="grid gap-1.5">
        <Label htmlFor="startup-name">Startup name</Label>
        <Input
          defaultValue={value.name}
          disabled={disabled}
          id="startup-name"
          name="name"
          placeholder="Acme Analytics"
          type="text"
        />
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="startup-type">Startup type</Label>
        <Select
          disabled={disabled}
          onValueChange={(v) =>
            onChange({ ...value, type: v as StartupDraft["type"] })
          }
          value={value.type}
        >
          <SelectTrigger id="startup-type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STARTUP_TYPES.map((type) => (
              <SelectItem key={type} value={type}>
                {type}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="startup-stage">Stage</Label>
        <Select
          disabled={disabled}
          onValueChange={(v) =>
            onChange({ ...value, stage: v as StartupDraft["stage"] })
          }
          value={value.stage}
        >
          <SelectTrigger id="startup-stage">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STARTUP_STAGES.map((stage) => (
              <SelectItem key={stage} value={stage}>
                {stage}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="startup-timezone">Timezone</Label>
        <Select
          disabled={disabled}
          onValueChange={(v) =>
            onChange({ ...value, timezone: v as StartupDraft["timezone"] })
          }
          value={value.timezone}
        >
          <SelectTrigger id="startup-timezone">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STARTUP_TIMEZONES.map((timezone) => (
              <SelectItem key={timezone} value={timezone}>
                {timezone}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="startup-currency">Currency</Label>
        <Select
          disabled={disabled}
          onValueChange={(v) =>
            onChange({ ...value, currency: v as StartupDraft["currency"] })
          }
          value={value.currency}
        >
          <SelectTrigger id="startup-currency">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STARTUP_CURRENCIES.map((currency) => (
              <SelectItem key={currency} value={currency}>
                {currency}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Button disabled={disabled} type="submit">
        {disabled ? "Creating startup\u2026" : "Create startup"}
      </Button>
    </form>
  );
}
