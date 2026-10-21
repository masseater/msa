import ai from "@msa/ai";
import testing from "@msa/testing";
import { Effect } from "effect";
import { vi } from "vite-plus/test";

import config from "../src/config.ts";
import AuthStorage from "../src/core/auth-storage.ts";
import ModelRuntime from "../src/core/model-runtime.ts";

const { ENV_AGENT_DIR } = config;
const { InMemoryModelsStore } = ai;

const {
  awaited,
  changeMode,
  joinPath,
  makeDirectory,
  makeTempDir,
  removePath,
  toJsonText,
  writeTextFile,
} = testing;

let agentDir = "";

const currentAgentDir = (): string => agentDir;

const prepareAgentDir: Effect.Effect<void> = Effect.gen(function* () {
  agentDir = yield* makeTempDir("msa-cli-agents-");
  vi.stubEnv(ENV_AGENT_DIR, agentDir);
});

const cleanAgentDir: Effect.Effect<void> = Effect.suspend(() => removePath(agentDir));

const accountsFile = (): string => joinPath(agentDir, "claude-code-accounts.json");

const writeAccounts = (accounts: unknown[]): Effect.Effect<void> =>
  Effect.flatMap(toJsonText({ accounts }), (text) => writeTextFile(accountsFile(), text));

const managed = (name: string): string => joinPath(agentDir, "claude-accounts", name);

const writeScript = Effect.fn("writeScript")(function* (file: string, script: string) {
  yield* writeTextFile(file, `#!/bin/sh\n${script}\n`);
  yield* changeMode(file, 0o755);
});

const fakeClaude = Effect.fn("fakeClaude")(function* (script: string) {
  const bin = joinPath(agentDir, "bin");
  yield* makeDirectory(bin);
  yield* writeScript(joinPath(bin, "claude"), script);
  vi.stubEnv("CLAUDE_BIN", joinPath(bin, "claude"));
});

const createModelRuntime = () =>
  awaited(
    ModelRuntime.create({
      allowModelNetwork: false,
      credentials: AuthStorage.inMemory(),
      modelsPath: null,
      modelsStore: new InMemoryModelsStore(),
    }),
  );

const cliAgentsSupport = {
  accountsFile,
  cleanAgentDir,
  createModelRuntime,
  currentAgentDir,
  fakeClaude,
  managed,
  prepareAgentDir,
  writeAccounts,
  writeScript,
};

export default cliAgentsSupport;
