import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import type { AssistantMessageEvent, Model, TranscriptContext } from "@msa/ai/compat";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ENV_AGENT_DIR } from "../src/config.ts";
import type { ExtensionAPI, ProviderConfig } from "../src/core/extensions/types.ts";
import {
  accountEnv,
  blockIfUnusable,
  blockOf,
  clearBlocks,
  loadAccounts,
  parseReset,
} from "../src/extensions/cli-agents/claude-accounts.ts";
import { registerOpenCode } from "../src/extensions/cli-agents/opencode.ts";

let dir: string;
const savedEnv = { ...process.env };

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "msa-cli-agents-"));
  process.env[ENV_AGENT_DIR] = dir;
});

afterEach(() => {
  process.env = { ...savedEnv };
  rmSync(dir, { recursive: true, force: true });
});

function writeAccounts(accounts: unknown[]): void {
  writeFileSync(join(dir, "claude-code-accounts.json"), JSON.stringify({ accounts }));
}

describe("parseReset", () => {
  const now = new Date(2026, 9, 17, 16, 0);

  it("reads a reset date and time", () => {
    expect(parseReset("You've hit your weekly limit · resets Oct 19 at 3pm", now)).toBe(
      new Date(2026, 9, 19, 15, 0).getTime(),
    );
  });

  it("puts a time already past today on the next day", () => {
    expect(parseReset("limit reached · resets 3:30pm", now)).toBe(
      new Date(2026, 9, 18, 15, 30).getTime(),
    );
  });

  it("returns undefined without a reset time", () => {
    expect(parseReset("something else", now)).toBeUndefined();
  });
});

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
    expect(
      blockIfUnusable(account, "You've hit your weekly limit · resets Oct 19 at 3pm", true),
    ).toBe(true);
    expect(blockOf(account, new Date(2026, 9, 19, 14, 0).getTime())?.reason).toContain(
      "weekly limit",
    );
    expect(blockOf(account, new Date(2026, 9, 19, 15, 1).getTime())).toBeUndefined();
    clearBlocks();
    expect(blockOf(account, new Date(2026, 9, 19, 14, 0).getTime())).toBeUndefined();
  });

  it("does not block an account for an ordinary failure", () => {
    const account = { name: "main" };
    expect(blockIfUnusable(account, "overloaded", false)).toBe(false);
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
    expect(blockIfUnusable(account, String(error), false)).toBe(true);
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
