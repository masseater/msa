import type settingsManagerTypes from "./settings-manager.types.ts";

const REDACTED = "<redacted>";

const SENSITIVE_KEY =
  /(?:^|[-_])(api[-_]?key|secret|token|password|passwd|credential|authorization|cookie)(?:$|[-_])/iu;

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY.test(key.replace(/([a-z0-9])([A-Z])/gu, "$1_$2"));
}

function redactUrl(value: string): string {
  const nested = /^([a-z][a-z0-9+.-]*:)([a-z][a-z0-9+.-]*:\/\/.*)$/iu.exec(value);
  const [, scheme, inner] = nested ?? [];
  if (scheme !== undefined && inner !== undefined) return `${scheme}${redactUrl(inner)}`;
  try {
    const url = new URL(value);
    let changed = false;
    if (url.username !== "" || url.password !== "") {
      url.username = "";
      url.password = "";
      changed = true;
    }
    for (const key of url.searchParams.keys()) {
      if (isSensitiveKey(key)) {
        url.searchParams.set(key, REDACTED);
        changed = true;
      }
    }
    return changed ? url.toString() : value;
  } catch {
    return value;
  }
}

function redactJsonValue(value: unknown): unknown {
  if (value === undefined) return undefined;
  return JSON.parse(
    JSON.stringify(value, (key, child: unknown) => {
      if (child !== null && child !== undefined && isSensitiveKey(key)) return REDACTED;
      return typeof child === "string" ? redactUrl(child) : child;
    }),
  );
}

function redactSettings(settings: settingsManagerTypes.Settings): settingsManagerTypes.Settings {
  const { trackingId: _trackingId, deviceId: _deviceId, ...rest } = settings;
  return redactJsonValue(rest) as settingsManagerTypes.Settings;
}

const bugReportRedaction = { redactJsonValue, redactSettings, redactUrl };

export default bugReportRedaction;
