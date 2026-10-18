import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";

import type { AssistantMessageEvent, Model, TranscriptContext } from "@msa/ai/compat";
import {
  awaited,
  runTest,
  currentTimeMillis,
  abortController,
  readTextFile,
  writeTextFile,
  changeMode,
  joinPath,
  dateFromMillis,
  removePath,
} from "@msa/testing";
import { Effect, Stream } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { ENV_AGENT_DIR } from "../src/config.ts";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ProviderConfig,
  RegisteredCommand,
} from "../src/core/extensions/types.ts";
import { envNames, envSnapshot, writeEnv } from "../src/core/process-env.ts";
import accountsExtension from "../src/extensions/accounts/index.ts";
import {
  accountEnv,
  addAccount,
  authStatus,
  blockIfUnusable,
  blockOf,
  clearBlocks,
  loadAccounts,
  loginAccount,
  preferAccount,
  removeAccount,
  setAutoRotation,
} from "../src/extensions/cli-agents/claude-accounts.ts";
import { claudeCodeService } from "../src/extensions/cli-agents/claude-service.ts";
import { registerOpenCode } from "../src/extensions/cli-agents/opencode.ts";

let dir: string;
const savedEnv = { ...envSnapshot() };

beforeEach(() =>
  runTest(
    Effect.gen(function* () {
      yield* Effect.void;
      dir = mkdtempSync(joinPath(tmpdir(), "msa-cli-agents-"));
      process.env[ENV_AGENT_DIR] = dir;
    }),
  ),
);

afterEach(() =>
  runTest(
    Effect.gen(function* () {
      for (const key of envNames()) if (!(key in savedEnv)) delete process.env[key];
      Object.assign(process.env, savedEnv);
      yield* removePath(dir);
    }),
  ),
);

function writeAccounts(accounts: unknown[]): void {
  writeFileSync(joinPath(dir, "claude-code-accounts.json"), JSON.stringify({ accounts }));
}

describe("Claude Code accounts", () => {
  it("uses msa's environment when no accounts are configured", () => {
    expect(loadAccounts()).toEqual([{ name: "default" }]);
  });

  it("expands ~ in configDir", () => {
    writeAccounts([{ name: "main", configDir: "~/claude-main" }]);
    expect(loadAccounts()).toEqual([
      { name: "main", configDir: joinPath(homedir(), "claude-main") },
    ]);
  });

  it("blocks an account that hit its usage limit until the reset", () => {
    const account = { name: "main" };
    const resetsAt = dateFromMillis(2026).getTime();
    expect(
      blockIfUnusable(account, {
        error: "You've hit your weekly limit",
        cause: "usage_limit",
        resetsAt,
      }),
    ).toBe(true);
    expect(blockOf(account, resetsAt - 60_000)?.reason).toContain("weekly limit");
    expect(blockOf(account, resetsAt + 60_000)).toBeUndefined();
    clearBlocks();
    expect(blockOf(account, resetsAt - 60_000)).toBeUndefined();
  });

  it("blocks an account by the error Claude Code classified", () => {
    const now = currentTimeMillis();
    const account = { name: "main" };
    expect(blockIfUnusable(account, { error: "401", cause: "authentication_failed" })).toBe(true);
    expect(blockOf(account, now + 60_000)).toBeDefined();
    expect(blockOf(account, now + 11 * 60_000)).toBeUndefined();
    expect(blockIfUnusable(account, { error: "on hold", cause: "account_on_hold" })).toBe(true);
    expect(blockOf(account, now + 23 * 60 * 60_000)).toBeDefined();
  });

  it("does not block an account for an ordinary failure", () => {
    const account = { name: "main" };
    expect(blockIfUnusable(account, { error: "overloaded", cause: "overloaded" })).toBe(false);
    expect(blockIfUnusable(account, { error: "429", cause: "rate_limit" })).toBe(false);
    expect(blockOf(account)).toBeUndefined();
  });

  it("gives the token printed by tokenCommand only to that account", () =>
    runTest(
      Effect.gen(function* () {
        process.env["CLAUDE_CODE_OAUTH_TOKEN"] = "inherited";
        process.env["SHELL"] = "/bin/sh";
        const env = yield* awaited(
          accountEnv({ name: "token", tokenCommand: "printf 'tok-123\\n'" }),
        );
        expect(env["CLAUDE_CODE_OAUTH_TOKEN"]).toBe("tok-123");
        const configured = yield* awaited(
          accountEnv({ name: "dir", configDir: "/tmp/claude-dir" }),
        );
        expect(configured["CLAUDE_CODE_OAUTH_TOKEN"]).toBeUndefined();
        expect(configured["CLAUDE_CONFIG_DIR"]).toBe("/tmp/claude-dir");
      }),
    ));

  it("blocks an account whose tokenCommand fails", () =>
    runTest(
      Effect.gen(function* () {
        process.env["SHELL"] = "/bin/sh";
        const account = { name: "broken", tokenCommand: "echo nope >&2; exit 1" };
        const error = yield* awaited(accountEnv(account).catch((caught: Error) => caught.message));
        expect(error).toMatch(/^tokenCommand .*: nope$/u);
        expect(blockIfUnusable(account, { error: String(error) })).toBe(true);
      }),
    ));
});

describe("managing Claude Code accounts", () => {
  const managed = (name: string) => joinPath(dir, "claude-accounts", name);

  it("keeps the implicit default account when the first account is added", () => {
    addAccount("work");
    expect(loadAccounts()).toEqual([
      { name: "default" },
      { name: "work", configDir: managed("work") },
    ]);
  });

  it("adds a tokenCommand account and rejects bad or duplicate names", () => {
    addAccount("token", "op read op://vault/claude");
    expect(loadAccounts().at(-1)).toEqual({
      name: "token",
      tokenCommand: "op read op://vault/claude",
    });
    expect(() => addAccount("token")).toThrow(/already exists/u);
    expect(() => addAccount("Bad Name")).toThrow(/must be lowercase/u);
  });

  it("reorders, toggles rotation and removes accounts, keeping ~ as written", () => {
    writeAccounts([{ name: "main", configDir: "~/claude-main" }, { name: "sub" }]);
    preferAccount("sub");
    setAutoRotation("main", false);
    const file = JSON.parse(readFileSync(joinPath(dir, "claude-code-accounts.json"), "utf8"));
    expect(file.accounts).toEqual([
      { name: "sub" },
      { name: "main", configDir: "~/claude-main", auto: false },
    ]);
    setAutoRotation("main", true);
    expect(loadAccounts()[1]?.auto).toBeUndefined();
    removeAccount("sub");
    expect(loadAccounts().map((account) => account.name)).toEqual(["main"]);
    expect(() => removeAccount("main")).toThrow(/must remain/u);
    expect(() => preferAccount("nope")).toThrow(/No Claude account/u);
  });

  it("deletes the config dir msa made for a removed account", () => {
    const account = addAccount("work");
    mkdirSync(account.configDir!, { recursive: true });
    blockIfUnusable(account, { error: "You've hit your limit", cause: "usage_limit" });
    removeAccount("work");
    expect(existsSync(managed("work"))).toBe(false);
    expect(blockOf(account)).toBeUndefined();
  });

  function fakeClaude(script: string): void {
    const bin = joinPath(dir, "bin");
    mkdirSync(bin, { recursive: true });
    writeFileSync(joinPath(bin, "claude"), `#!/bin/sh\n${script}\n`);
    chmodSync(joinPath(bin, "claude"), 0o755);
    process.env["CLAUDE_BIN"] = joinPath(bin, "claude");
  }

  it("signs an account in with the code the user pastes", () =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        fakeClaude(
          [
            `if [ "$1 $2" = "auth status" ]; then`,
            `  if [ -f "$CLAUDE_CONFIG_DIR/token" ]; then echo '{"loggedIn":true,"email":"a@example.com"}'; else echo '{"loggedIn":false}'; exit 1; fi`,
            `  exit 0`,
            `fi`,
            `echo "Opening browser to sign in…"`,
            `echo "If the browser didn't open, visit: https://claude.com/oauth?x=1"`,
            `printf "Paste code here if prompted > "`,
            `read code`,
            `printf %s "$code" > "$CLAUDE_CONFIG_DIR/token"`,
          ].join("\n"),
        );
        const account = addAccount("work");
        expect(yield* awaited(authStatus(account))).toEqual({ loggedIn: false });
        blockIfUnusable(account, { error: "Not logged in · Please run /login" });
        let shown = "";
        yield* awaited(
          loginAccount(account, {
            askCode: (url) =>
              effectRunPromise(
                Effect.gen(function* () {
                  shown = url;
                  return yield* awaited("the-code");
                }),
              ),
          }),
        );
        expect(shown).toBe("https://claude.com/oauth?x=1");
        expect(yield* readTextFile(joinPath(managed("work"), "token"))).toBe("the-code");
        expect(yield* awaited(authStatus(account))).toEqual({
          loggedIn: true,
          email: "a@example.com",
        });
        expect(blockOf(account)).toBeUndefined();
      }),
    ));

  it("cancels the login when the user gives no code", () =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        fakeClaude(`echo "visit: https://claude.com/oauth"\nread code\nexit 1`);
        const account = addAccount("work");
        yield* awaited(
          expect(
            loginAccount(account, { askCode: () => effectRunPromise(awaited(undefined)) }),
          ).rejects.toThrow(/cancelled/u),
        );
      }),
    ));
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

  function interaction(answers: { select?: string; prompts: string[] }) {
    return {
      showPage: vi.fn(),
      select: vi.fn(() => runTest(awaited(answers.select!))),
      prompt: vi.fn(() => runTest(awaited(answers.prompts.shift()!))),
    };
  }

  it("tells /login how to install Claude Code when it is missing", () =>
    runTest(
      Effect.gen(function* () {
        process.env["CLAUDE_BIN"] = "";
        process.env["PATH"] = joinPath(dir, "empty");
        expect(yield* awaited(claudeCodeService.status())).toEqual({
          installed: false,
          install: "curl -fsSL https://claude.ai/install.sh | bash",
        });
      }),
    ));

  it("signs the only account in from /login without asking which", () =>
    runTest(
      Effect.gen(function* () {
        fakeClaude(claudeWithLogin);
        writeAccounts([{ name: "work", configDir: managed("work") }]);
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

  it("adds a new account from /login when there are several", () =>
    runTest(
      Effect.gen(function* () {
        fakeClaude(claudeWithLogin);
        writeAccounts([
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

describe("/accounts", () => {
  function command(): RegisteredCommand {
    let registered: RegisteredCommand | undefined;
    accountsExtension({
      registerCommand: (name: string, options: Omit<RegisteredCommand, "name" | "sourceInfo">) => {
        if (name === "accounts") registered = options as RegisteredCommand;
      },
    } as unknown as ExtensionAPI);
    if (!(registered !== undefined)) throw new Error("command not registered");
    return registered;
  }

  function context() {
    const notes: string[] = [];
    let reloads = 0;
    const ctx = {
      hasUI: false,
      ui: { notify: (message: string) => notes.push(message) },
      reload: () =>
        runTest(
          Effect.sync(() => {
            reloads += 1;
          }),
        ),
    } as unknown as ExtensionCommandContext;
    return { ctx, notes, reloads: () => reloads };
  }

  it("completes kinds, then the kind's actions and account names", () =>
    runTest(
      Effect.gen(function* () {
        writeAccounts([{ name: "main" }, { name: "sub" }]);
        const complete = command().getArgumentCompletions!;
        expect((yield* awaited(complete("cl")))?.map((item) => item.value)).toEqual(["claude "]);
        expect((yield* awaited(complete("claude lo")))?.map((item) => item.value)).toEqual([
          "claude login ",
          "claude logout ",
        ]);
        expect((yield* awaited(complete("claude use s")))?.map((item) => item.value)).toEqual([
          "claude use sub",
        ]);
      }),
    ));

  it("routes to the kind and reloads when the account list changes", () =>
    runTest(
      Effect.gen(function* () {
        process.env["CLAUDE_BIN"] = "/bin/false";
        const { ctx, notes, reloads } = context();
        yield* awaited(command().handler("claude add token printf tok", ctx));
        expect(loadAccounts().map((account) => account.name)).toEqual(["default", "token"]);
        expect(reloads()).toBe(1);
        yield* awaited(command().handler("", ctx));
        expect(notes.at(-1)).toMatch(/^claude:\n1\. default .*\n2\. token /u);
        yield* awaited(command().handler("nope", ctx));
        expect(notes.at(-1)).toMatch(/Unknown account kind "nope"/u);
      }),
    ));
});

describe("opencode-free provider", () => {
  function register(): ProviderConfig {
    let config: ProviderConfig | undefined;
    registerOpenCode({
      registerProvider: (_id: string, input: ProviderConfig) => {
        config = input;
      },
    } as unknown as ExtensionAPI);
    if (!(config !== undefined)) throw new Error("provider not registered");
    return config;
  }

  function run(script: string): Promise<AssistantMessageEvent[]> {
    return runTest(
      Effect.gen(function* () {
        const bin = joinPath(dir, "opencode");
        yield* writeTextFile(bin, `#!/bin/sh\ncat > "${dir}/stdin.txt"\n${script}\n`);
        yield* changeMode(bin, 0o755);
        writeEnv("OPENCODE_BIN", bin);
        const config = register();
        const model = {
          ...config.models![0]!,
          provider: "opencode-free",
          api: "openai-completions" as const,
        };
        const context = {
          messages: [{ role: "user", content: "hello", timestamp: 0 }],
        } as unknown as TranscriptContext;
        const stream = (
          config.streamSimple as (
            m: Model<string>,
            c: TranscriptContext,
          ) => AsyncIterable<AssistantMessageEvent>
        )(model as unknown as Model<string>, context);
        return Array.from(
          yield* Stream.runCollect(Stream.fromAsyncIterable(stream, (error) => error)),
        );
      }),
    );
  }

  it("streams the CLI's text and usage as the reply", () =>
    runTest(
      Effect.gen(function* () {
        const events = yield* awaited(
          run(
            [
              `echo '{"type":"text","part":{"id":"a","type":"text","text":"Hi"}}'`,
              `echo '{"type":"text","part":{"id":"a","type":"text","text":"Hi there"}}'`,
              `echo '{"type":"step_finish","part":{"tokens":{"input":5,"output":2,"cache":{"read":1,"write":0}}}}'`,
            ].join("\n"),
          ),
        );
        const done = events.at(-1);
        expect(done?.type).toBe("done");
        if (done?.type !== "done") return;
        expect(done.message.content).toEqual([{ type: "text" as const, text: "Hi there" }]);
        expect(done.message.usage).toMatchObject({
          input: 5,
          output: 2,
          cacheRead: 1,
          totalTokens: 8,
        });
      }),
    ));

  it("reports an error event as a failed reply even when the CLI exits 0", () =>
    runTest(
      Effect.gen(function* () {
        const events = yield* awaited(
          run(`echo '{"type":"error","error":{"message":"quota exceeded"}}'`),
        );
        const last = events.at(-1);
        expect(last?.type).toBe("error");
        if (last?.type !== "error") return;
        expect(last.error.errorMessage).toBe("quota exceeded");
      }),
    ));
});
