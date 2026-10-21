import type settingsSelectorTypes from "./settings-selector.types.ts";

type Callbacks = settingsSelectorTypes.SettingsCallbacks;
type SettingEntry = settingsSelectorTypes.SettingEntry;

interface Labels {
  id: string;
  label: string;
  description: string;
}

function toggle(
  labels: Labels,
  enabled: boolean,
  apply: (callbacks: Callbacks, enabled: boolean) => void,
): SettingEntry {
  return {
    apply: (value, callbacks) => apply(callbacks, value === "true"),
    item: { ...labels, currentValue: enabled ? "true" : "false", values: ["true", "false"] },
  };
}

function choice<T extends string>(
  labels: Labels,
  currentValue: T,
  values: readonly T[],
  apply: (callbacks: Callbacks, value: T) => void,
): SettingEntry {
  return {
    apply: (value, callbacks) => apply(callbacks, value as T),
    item: { ...labels, currentValue, values: [...values] },
  };
}

function numeric(
  labels: Labels,
  currentValue: number,
  values: readonly string[],
  apply: (callbacks: Callbacks, value: number) => void,
): SettingEntry {
  return {
    apply: (value, callbacks) => apply(callbacks, parseInt(value, 10)),
    item: { ...labels, currentValue: String(currentValue), values: [...values] },
  };
}

const settingEntry = {
  choice,
  numeric,
  toggle,
};

export default settingEntry;
