import { homedir } from "node:os";

import {
  awaited,
  changeMode,
  currentTimeMillis,
  dateFromMillis,
  joinPath,
  makeDirectory,
  makeTempDir,
  pathExists,
  readJsonFile,
  readTextFile,
  removePath,
  runTest,
  writeJsonFile,
  writeTextFile,
} from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { ENV_AGENT_DIR } from "../src/config.ts";
import { deleteEnv, withEnv, writeEnv } from "../src/core/process-env.ts";
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

let dir = "";

beforeEach(() =>
  runTest(
    Effect.gen(function* () {
      dir = yield* makeTempDir("msa-cli-agents-");
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

describe("Claude Code accounts", () => {
  it("uses msa's environment when no accounts are configured", () => {
    expect(loadAccounts()).toEqual([{ name: "default" }]);
  });

  it("expands ~ in configDir", () =>
    runTest(
      Effect.gen(function* () {
        yield* writeAccounts([{ name: "main", configDir: "~/claude-main" }]);
        expect(loadAccounts()).toEqual([
          { name: "main", configDir: joinPath(homedir(), "claude-main") },
        ]);
      }),
    ));

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
        const env = yield* awaited(
          accountEnv({ name: "token", tokenCommand: "printf 'tok-123\\n'" }),
        );
        expect(env["CLAUDE_CODE_OAUTH_TOKEN"]).toBe("tok-123");
        const configured = yield* awaited(
          accountEnv({ name: "dir", configDir: "/tmp/claude-dir" }),
        );
        expect(configured["CLAUDE_CODE_OAUTH_TOKEN"]).toBeUndefined();
        expect(configured["CLAUDE_CONFIG_DIR"]).toBe("/tmp/claude-dir");
      }).pipe(withEnv({ CLAUDE_CODE_OAUTH_TOKEN: "inherited", SHELL: "/bin/sh" })),
    ));

  it("blocks an account whose tokenCommand fails", () =>
    runTest(
      Effect.gen(function* () {
        const account = { name: "broken", tokenCommand: "echo nope >&2; exit 1" };
        const error = yield* awaited(accountEnv(account).catch((caught: Error) => caught.message));
        expect(error).toMatch(/^tokenCommand .*: nope$/u);
        expect(blockIfUnusable(account, { error: String(error) })).toBe(true);
      }).pipe(withEnv({ SHELL: "/bin/sh" })),
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

  it("reorders, toggles rotation and removes accounts, keeping ~ as written", () =>
    runTest(
      Effect.gen(function* () {
        yield* writeAccounts([{ name: "main", configDir: "~/claude-main" }, { name: "sub" }]);
        preferAccount("sub");
        setAutoRotation("main", false);
        expect(yield* readJsonFile(joinPath(dir, "claude-code-accounts.json"))).toEqual({
          accounts: [{ name: "sub" }, { name: "main", configDir: "~/claude-main", auto: false }],
        });
        setAutoRotation("main", true);
        expect(loadAccounts()[1]?.auto).toBeUndefined();
        removeAccount("sub");
        expect(loadAccounts().map((account) => account.name)).toEqual(["main"]);
        expect(() => removeAccount("main")).toThrow(/must remain/u);
        expect(() => preferAccount("nope")).toThrow(/No Claude account/u);
      }),
    ));

  it("deletes the config dir msa made for a removed account", () =>
    runTest(
      Effect.gen(function* () {
        const account = addAccount("work");
        yield* makeDirectory(account.configDir!);
        blockIfUnusable(account, { error: "You've hit your limit", cause: "usage_limit" });
        removeAccount("work");
        expect(yield* pathExists(managed("work"))).toBe(false);
        expect(blockOf(account)).toBeUndefined();
      }),
    ));

  it("signs an account in with the code the user pastes", () =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        yield* fakeClaude(
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

        yield* fakeClaude(`echo "visit: https://claude.com/oauth"\nread code\nexit 1`);
        const account = addAccount("work");
        yield* awaited(
          expect(
            loginAccount(account, { askCode: () => effectRunPromise(awaited(undefined)) }),
          ).rejects.toThrow(/cancelled/u),
        );
      }),
    ));
});
