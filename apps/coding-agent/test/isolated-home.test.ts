import { homedir, userInfo } from "node:os";
import { join } from "node:path";

import { expect, it } from "vite-plus/test";

import { getAgentDir } from "../src/config.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";

it("runs with a home directory other than the account's real one", () => {
  expect(homedir()).not.toBe(userInfo().homedir);
});

it("resolves the agent directory and the default orchestrator database inside that home", () => {
  expect(getAgentDir()).toBe(join(homedir(), ".msa", "agent"));
  expect(SettingsManager.inMemory().getOrchestratorDatabasePath()).toBe(
    join(homedir(), ".msa", "agent", "orchestrator.db"),
  );
});
