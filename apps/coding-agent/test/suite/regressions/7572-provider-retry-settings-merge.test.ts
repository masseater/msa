import { describe, expect, it } from "vite-plus/test";

import { InMemorySettingsStorage, SettingsManager } from "../../../src/core/settings-manager.ts";

const preservesGlobalProviderSettingsNotOverridden = () => {
  const storage = new InMemorySettingsStorage();
  storage.withLock("global", () =>
    JSON.stringify({
      retry: {
        provider: {
          timeoutMs: 30000,
          maxRetryDelayMs: 45000,
        },
      },
    }),
  );
  storage.withLock("project", () =>
    JSON.stringify({
      retry: {
        provider: {
          maxRetries: 2,
        },
      },
    }),
  );

  const settingsManager = SettingsManager.fromStorage(storage);

  expect(settingsManager.getProviderRetrySettings()).toEqual({
    timeoutMs: 30000,
    maxRetries: 2,
    maxRetryDelayMs: 45000,
  });
};

describe("regression #7572: nested provider retry settings merge", () => {
  it(
    "preserves global provider settings not overridden by the project",
    preservesGlobalProviderSettingsNotOverridden,
  );
});
