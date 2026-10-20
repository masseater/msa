import type settingsManagerTypes from "./settings-manager.types.ts";

export default class InMemorySettingsStorage implements settingsManagerTypes.SettingsStorage {
  private global: string | undefined;
  private project: string | undefined;

  withLock(
    scope: settingsManagerTypes.SettingsScope,
    fn: (current: string | undefined) => string | undefined,
  ): void {
    const current = scope === "global" ? this.global : this.project;
    const next = fn(current);
    if (next !== undefined) {
      if (scope === "global") {
        this.global = next;
      } else {
        this.project = next;
      }
    }
  }
}
