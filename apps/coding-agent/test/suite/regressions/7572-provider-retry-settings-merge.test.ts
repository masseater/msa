import { describe, expect, it } from "vite-plus/test";

import InMemorySettingsStorage from "../../../src/core/in-memory-settings-storage.ts";
import SettingsManager from "../../../src/core/settings-manager.ts";

const preservesGlobalProviderSettingsNotOverridden = () => {
  const storage = new InMemorySettingsStorage();
  storage.withLock("global", () =>
    JSON.stringify({
      retry: {
        provider: {
          maxRetryDelayMs: 45000,
          timeoutMs: 30000,
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

  expect(settingsManager.session.getProviderRetrySettings()).toEqual({
    maxRetries: 2,
    maxRetryDelayMs: 45000,
    timeoutMs: 30000,
  });
};

describe("regression #7572: nested provider retry settings merge", () => {
  it(
    "preserves global provider settings not overridden by the project",
    preservesGlobalProviderSettingsNotOverridden,
  );
});
