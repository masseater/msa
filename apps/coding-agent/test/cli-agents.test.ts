import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import type { AssistantMessageEvent, Model, TranscriptContext } from "@msa/ai/compat";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { ENV_AGENT_DIR } from "../src/config.ts";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ProviderConfig,
  RegisteredCommand,
} from "../src/core/extensions/types.ts";
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
const savedEnv = { ...process.env };

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "msa-cli-agents-"));
  process.env[ENV_AGENT_DIR] = dir;
});

afterEach(() => {
  // Restore in place: from Node 26 a child process ignores a replaced process.env object, so later
  // tests that change PATH would still spawn with the original one.
  for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key];
  Object.assign(process.env, savedEnv);
  rmSync(dir, { recursive: true, force: true });
});

function writeAccounts(accounts: unknown[]): void {
  writeFileSync(join(dir, "claude-code-accounts.json"), JSON.stringify({ accounts }));
}

describe("Claude Code accounts", () => {
  it("uses msa's environment when no accounts are configured", () => {
    expect(loadAccounts()).toEqual([{ name: "default" }]);
  });

  it("expands ~ in configDir", () => {
    writeAccounts([{ name: "main", configDir: "~/claude-main" }]);
    expect(loadAccounts()).toEqual([{ name: "main", configDir: join(homedir(), "claude-main") }]);
  });

  it("blocks an account that hit its usage limit until the reset", () => {
    const account = { name: "main" };
    const resetsAt = new Date(2026, 9, 19, 15, 0).getTime();
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
    const now = Date.now();
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

  it("gives the token printed by tokenCommand only to that account", async () => {
    process.env["CLAUDE_CODE_OAUTH_TOKEN"] = "inherited";
    process.env["SHELL"] = "/bin/sh";
    const env = await accountEnv({ name: "token", tokenCommand: "printf 'tok-123\\n'" });
    expect(env["CLAUDE_CODE_OAUTH_TOKEN"]).toBe("tok-123");
    const configured = await accountEnv({ name: "dir", configDir: "/tmp/claude-dir" });
    expect(configured["CLAUDE_CODE_OAUTH_TOKEN"]).toBeUndefined();
    expect(configured["CLAUDE_CONFIG_DIR"]).toBe("/tmp/claude-dir");
  });

  it("blocks an account whose tokenCommand fails", async () => {
    process.env["SHELL"] = "/bin/sh";
    const account = { name: "broken", tokenCommand: "echo nope >&2; exit 1" };
    const error = await accountEnv(account).catch((caught: Error) => caught.message);
    expect(error).toMatch(/^tokenCommand .*: nope$/);
    expect(blockIfUnusable(account, { error: String(error) })).toBe(true);
  });
});

describe("managing Claude Code accounts", () => {
  const managed = (name: string) => join(dir, "claude-accounts", name);

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
    expect(() => addAccount("token")).toThrow(/already exists/);
    expect(() => addAccount("Bad Name")).toThrow(/must be lowercase/);
  });

  it("reorders, toggles rotation and removes accounts, keeping ~ as written", () => {
    writeAccounts([{ name: "main", configDir: "~/claude-main" }, { name: "sub" }]);
    preferAccount("sub");
    setAutoRotation("main", false);
    const file = JSON.parse(readFileSync(join(dir, "claude-code-accounts.json"), "utf8"));
    expect(file.accounts).toEqual([
      { name: "sub" },
      { name: "main", configDir: "~/claude-main", auto: false },
    ]);
    setAutoRotation("main", true);
    expect(loadAccounts()[1]?.auto).toBeUndefined();
    removeAccount("sub");
    expect(loadAccounts().map((account) => account.name)).toEqual(["main"]);
    expect(() => removeAccount("main")).toThrow(/must remain/);
    expect(() => preferAccount("nope")).toThrow(/No Claude account/);
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
    const bin = join(dir, "bin");
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, "claude"), `#!/bin/sh\n${script}\n`);
    chmodSync(join(bin, "claude"), 0o755);
    process.env["CLAUDE_BIN"] = join(bin, "claude");
  }

  it("signs an account in with the code the user pastes", async () => {
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
    expect(await authStatus(account)).toEqual({ loggedIn: false });
    blockIfUnusable(account, { error: "Not logged in · Please run /login" });
    let shown = "";
    await loginAccount(account, {
      askCode: async (url) => {
        shown = url;
        return "the-code";
      },
    });
    expect(shown).toBe("https://claude.com/oauth?x=1");
    expect(readFileSync(join(managed("work"), "token"), "utf8")).toBe("the-code");
    expect(await authStatus(account)).toEqual({ loggedIn: true, email: "a@example.com" });
    expect(blockOf(account)).toBeUndefined();
  });

  it("cancels the login when the user gives no code", async () => {
    fakeClaude(`echo "visit: https://claude.com/oauth"\nread code\nexit 1`);
    const account = addAccount("work");
    await expect(loginAccount(account, { askCode: async () => undefined })).rejects.toThrow(
      /cancelled/,
    );
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

  function interaction(answers: { select?: string; prompts: string[] }) {
    return {
      showPage: vi.fn(),
      select: vi.fn(async () => answers.select!),
      prompt: vi.fn(async () => answers.prompts.shift()!),
    };
  }

  it("tells /login how to install Claude Code when it is missing", async () => {
    process.env["CLAUDE_BIN"] = "";
    process.env["PATH"] = join(dir, "empty");
    expect(await claudeCodeService.status()).toEqual({
      installed: false,
      install: "curl -fsSL https://claude.ai/install.sh | bash",
    });
  });

  it("signs the only account in from /login without asking which", async () => {
    fakeClaude(claudeWithLogin);
    writeAccounts([{ name: "work", configDir: managed("work") }]);
    expect(await claudeCodeService.status()).toEqual({ installed: true, signedIn: false });
    const ui = interaction({ prompts: ["the-code"] });
    await claudeCodeService.login(ui, new AbortController().signal);
    expect(ui.select).not.toHaveBeenCalled();
    expect(ui.showPage).toHaveBeenCalledWith({ url: "https://claude.com/oauth?x=1" });
    expect(await claudeCodeService.status()).toEqual({ installed: true, signedIn: true });

    await claudeCodeService.logout(interaction({ prompts: [] }));
    expect(await claudeCodeService.status()).toEqual({ installed: true, signedIn: false });
  });

  it("adds a new account from /login when there are several", async () => {
    fakeClaude(claudeWithLogin);
    writeAccounts([
      { name: "main", configDir: managed("main") },
      { name: "token", tokenCommand: "echo token" },
      { name: "sub", configDir: managed("sub") },
    ]);
    const ui = interaction({ select: "Add a new account", prompts: ["work", "the-code"] });
    await claudeCodeService.login(ui, new AbortController().signal);
    expect(ui.select).toHaveBeenCalledWith("Sign in which Claude account?", [
      "main",
      "sub",
      "Add a new account",
    ]);
    expect(loadAccounts().at(-1)).toEqual({ name: "work", configDir: managed("work") });
    expect(readFileSync(join(managed("work"), "token"), "utf8")).toBe("the-code");
  });
});

describe("/accounts", () => {
  function command(): RegisteredCommand {
    let registered: RegisteredCommand | undefined;
    accountsExtension({
      registerCommand: (name: string, options: Omit<RegisteredCommand, "name" | "sourceInfo">) => {
        if (name === "accounts") registered = options as RegisteredCommand;
      },
    } as unknown as ExtensionAPI);
    if (!registered) throw new Error("command not registered");
    return registered;
  }

  function context() {
    const notes: string[] = [];
    let reloads = 0;
    const ctx = {
      hasUI: false,
      ui: { notify: (message: string) => notes.push(message) },
      reload: async () => {
        reloads += 1;
      },
    } as unknown as ExtensionCommandContext;
    return { ctx, notes, reloads: () => reloads };
  }

  it("completes kinds, then the kind's actions and account names", async () => {
    writeAccounts([{ name: "main" }, { name: "sub" }]);
    const complete = command().getArgumentCompletions!;
    expect((await complete("cl"))?.map((item) => item.value)).toEqual(["claude "]);
    expect((await complete("claude lo"))?.map((item) => item.value)).toEqual([
      "claude login ",
      "claude logout ",
    ]);
    expect((await complete("claude use s"))?.map((item) => item.value)).toEqual(["claude use sub"]);
  });

  it("routes to the kind and reloads when the account list changes", async () => {
    process.env["CLAUDE_BIN"] = "/bin/false";
    const { ctx, notes, reloads } = context();
    await command().handler("claude add token printf tok", ctx);
    expect(loadAccounts().map((account) => account.name)).toEqual(["default", "token"]);
    expect(reloads()).toBe(1);
    await command().handler("", ctx);
    expect(notes.at(-1)).toMatch(/^claude:\n1\. default .*\n2\. token /);
    await command().handler("nope", ctx);
    expect(notes.at(-1)).toMatch(/Unknown account kind "nope"/);
  });
});

describe("opencode-free provider", () => {
  function register(): ProviderConfig {
    let config: ProviderConfig | undefined;
    registerOpenCode({
      registerProvider: (_id: string, input: ProviderConfig) => {
        config = input;
      },
    } as unknown as ExtensionAPI);
    if (!config) throw new Error("provider not registered");
    return config;
  }

  async function run(script: string): Promise<AssistantMessageEvent[]> {
    const bin = join(dir, "opencode");
    writeFileSync(bin, `#!/bin/sh\ncat > "${dir}/stdin.txt"\n${script}\n`);
    chmodSync(bin, 0o755);
    process.env["OPENCODE_BIN"] = bin;
    const config = register();
    const model = { ...config.models![0]!, provider: "opencode-free", api: "openai-completions" };
    const context = {
      messages: [{ role: "user", content: "hello", timestamp: 0 }],
    } as unknown as TranscriptContext;
    const events: AssistantMessageEvent[] = [];
    const stream = (
      config.streamSimple as (
        m: Model<string>,
        c: TranscriptContext,
      ) => AsyncIterable<AssistantMessageEvent>
    )(model as unknown as Model<string>, context);
    for await (const event of stream) events.push(event);
    return events;
  }

  it("streams the CLI's text and usage as the reply", async () => {
    const events = await run(
      [
        `echo '{"type":"text","part":{"id":"a","type":"text","text":"Hi"}}'`,
        `echo '{"type":"text","part":{"id":"a","type":"text","text":"Hi there"}}'`,
        `echo '{"type":"step_finish","part":{"tokens":{"input":5,"output":2,"cache":{"read":1,"write":0}}}}'`,
      ].join("\n"),
    );
    const done = events.at(-1);
    expect(done?.type).toBe("done");
    if (done?.type !== "done") return;
    expect(done.message.content).toEqual([{ type: "text", text: "Hi there" }]);
    expect(done.message.usage).toMatchObject({ input: 5, output: 2, cacheRead: 1, totalTokens: 8 });
  });

  it("reports an error event as a failed reply even when the CLI exits 0", async () => {
    const events = await run(`echo '{"type":"error","error":{"message":"quota exceeded"}}'`);
    const last = events.at(-1);
    expect(last?.type).toBe("error");
    if (last?.type !== "error") return;
    expect(last.error.errorMessage).toBe("quota exceeded");
  });
});
