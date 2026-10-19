import {
  abortController,
  awaited,
  changeMode,
  joinPath,
  makeDirectory,
  makeTempDir,
  readTextFile,
  removePath,
  runTest,
  writeJsonFile,
  writeTextFile,
} from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { ENV_AGENT_DIR } from "../src/config.ts";
import { deleteEnv, withEnv, writeEnv } from "../src/core/process-env.ts";
import { loadAccounts } from "../src/extensions/cli-agents/claude-accounts.ts";
import { claudeCodeService } from "../src/extensions/cli-agents/claude-service.ts";

let dir = "";

beforeEach(() =>
  runTest(
    Effect.gen(function* () {
      dir = yield* makeTempDir("msa-cli-agents-login-");
      yield* Effect.sync(() => writeEnv(ENV_AGENT_DIR, dir));
    }),
  ),
);

afterEach(() =>
  runTest(
    Effect.gen(function* () {
      yield* Effect.sync(() => deleteEnv(ENV_AGENT_DIR));
      yield* removePath(dir);
    }),
  ),
);

const managed = (name: string) => joinPath(dir, "claude-accounts", name);

const writeAccounts = (accounts: unknown[]): Effect.Effect<void> =>
  writeJsonFile(joinPath(dir, "claude-code-accounts.json"), { accounts });

const fakeClaude = (script: string): Effect.Effect<void> =>
  Effect.gen(function* () {
    const bin = joinPath(dir, "bin");
    yield* makeDirectory(bin);
    const executable = joinPath(bin, "claude");
    yield* writeTextFile(executable, `#!/bin/sh\n${script}\n`);
    yield* changeMode(executable, 0o755);
    yield* Effect.sync(() => writeEnv("CLAUDE_BIN", executable));
  });

const claudeWithLogin = [
  `if [ "$1 $2" = "auth status" ]; then`,
  `  if [ -f "$CLAUDE_CONFIG_DIR/token" ]; then echo '{"loggedIn":true,"email":"a@example.com"}'; else echo '{"loggedIn":false}'; exit 1; fi`,
  `  exit 0`,
  `fi`,
  `if [ "$1 $2" = "auth logout" ]; then rm -f "$CLAUDE_CONFIG_DIR/token"; exit 0; fi`,
  `echo "If the browser didn't open, visit: https://claude.com/oauth?x=1"`,
  `read code`,
  `printf %s "$code" > "$CLAUDE_CONFIG_DIR/token"`,
].join("\n");

const interaction = (answers: { select?: string; prompts: string[] }) => ({
  showPage: vi.fn(),
  select: vi.fn(() => runTest(awaited(answers.select!))),
  prompt: vi.fn(() => runTest(awaited(answers.prompts.shift()!))),
});

describe("/login", () => {
  it("tells /login how to install Claude Code when it is missing", () =>
    runTest(
      Effect.gen(function* () {
        vi.stubEnv("PATH", joinPath(dir, "empty"));
        expect(yield* awaited(claudeCodeService.status())).toEqual({
          installed: false,
          install: "curl -fsSL https://claude.ai/install.sh | bash",
        });
      }).pipe(withEnv({ CLAUDE_BIN: "" })),
    ));

  it("signs the only account in without asking which", () =>
    runTest(
      Effect.gen(function* () {
        yield* fakeClaude(claudeWithLogin);
        yield* writeAccounts([{ name: "work", configDir: managed("work") }]);
        expect(yield* awaited(claudeCodeService.status())).toEqual({
          installed: true,
          signedIn: false,
        });
        const ui = interaction({ prompts: ["the-code"] });
        yield* awaited(claudeCodeService.login(ui, abortController().signal));
        expect(ui.select).not.toHaveBeenCalled();
        expect(ui.showPage).toHaveBeenCalledWith({ url: "https://claude.com/oauth?x=1" });
        expect(yield* awaited(claudeCodeService.status())).toEqual({
          installed: true,
          signedIn: true,
        });

        yield* awaited(claudeCodeService.logout(interaction({ prompts: [] })));
        expect(yield* awaited(claudeCodeService.status())).toEqual({
          installed: true,
          signedIn: false,
        });
      }),
    ));

  it("adds a new account when there are several", () =>
    runTest(
      Effect.gen(function* () {
        yield* fakeClaude(claudeWithLogin);
        yield* writeAccounts([
          { name: "main", configDir: managed("main") },
          { name: "token", tokenCommand: "echo token" },
          { name: "sub", configDir: managed("sub") },
        ]);
        const ui = interaction({ select: "Add a new account", prompts: ["work", "the-code"] });
        yield* awaited(claudeCodeService.login(ui, abortController().signal));
        expect(ui.select).toHaveBeenCalledWith("Sign in which Claude account?", [
          "main",
          "sub",
          "Add a new account",
        ]);
        expect(loadAccounts().at(-1)).toEqual({ name: "work", configDir: managed("work") });
        expect(yield* readTextFile(joinPath(managed("work"), "token"))).toBe("the-code");
      }),
    ));
});
