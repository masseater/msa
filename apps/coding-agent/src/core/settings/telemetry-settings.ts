import platformNode from "../platform-node.ts";
import settingsDefaults from "../settings-defaults.ts";
import type SettingsManager from "../settings-manager.ts";

const { SETTINGS_DEFAULTS } = settingsDefaults;
const { randomUuid } = platformNode;

export default class TelemetrySettings {
  private readonly manager: SettingsManager;

  constructor(manager: SettingsManager) {
    this.manager = manager;
  }

  getTrackingId(): string | undefined {
    return this.manager.settings.trackingId;
  }

  getOtlpEndpoint(): string | undefined {
    const endpoint = this.manager.settings.telemetry?.otlpEndpoint?.trim();
    return endpoint !== undefined && endpoint !== "" ? endpoint : undefined;
  }

  getEnableInstallTelemetry(): boolean {
    return this.manager.settings.enableInstallTelemetry ?? SETTINGS_DEFAULTS.enableInstallTelemetry;
  }

  getEnableAnalytics(): boolean {
    return this.manager.settings.enableAnalytics ?? SETTINGS_DEFAULTS.enableAnalytics;
  }

  setEnableInstallTelemetry(enabled: boolean): void {
    this.manager.persistence.setGlobalSetting("enableInstallTelemetry", enabled);
  }

  setEnableAnalytics(enabled: boolean): void {
    this.manager.globalSettings.enableAnalytics = enabled;
    this.manager.persistence.markModified("enableAnalytics");
    if (
      enabled &&
      (this.manager.globalSettings.trackingId === undefined ||
        this.manager.globalSettings.trackingId === "")
    ) {
      this.manager.globalSettings.trackingId = randomUuid();
      this.manager.persistence.markModified("trackingId");
    }
    this.manager.persistence.save();
  }

  getOrCreateDeviceId(): string {
    if (
      this.manager.globalSettings.deviceId === undefined ||
      this.manager.globalSettings.deviceId === ""
    ) {
      this.manager.globalSettings.deviceId = randomUuid();
      this.manager.persistence.markModified("deviceId");
      this.manager.persistence.save();
    }
    return this.manager.globalSettings.deviceId;
  }
}
