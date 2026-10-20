import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import claudeAccounts from "../src/core/cli-agents/claude-accounts.ts";
import claudeService from "../src/core/cli-agents/claude-service.ts";
import cliAgentsSupport from "./cli-agents-support.ts";

const {
  addAccount,
  authStatus,
  blockIfUnusable,
  blockOf,
  loadAccounts,
  loginAccount,
  preferAccount,
  removeAccount,
  setAutoRotation,
} = claudeAccounts;
const { claudeCodeService } = claudeService;

const {
  abortController,
  awaited,
  joinPath,
  makeDirectory,
  pathExists,
  readJsonFile,
  readTextFile,
  runTest,
} = testing;
const {
  accountsFile,
  cleanAgentDir,
  currentAgentDir,
  fakeClaude,
  managed,
  prepareAgentDir,
  writeAccounts,
} = cliAgentsSupport;

beforeEach(() => runTest(prepareAgentDir));

afterEach(() => runTest(cleanAgentDir));

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
    prompt: vi.fn(() => runTest(Effect.sync(() => answers.prompts.shift()!))),
    select: vi.fn(() => runTest(Effect.succeed(answers.select!))),
    showPage: vi.fn(),
  };
}

const keepsTheImplicitDefaultAccountWhenThe = () => {
  addAccount("work");
  expect(loadAccounts()).toEqual([
    { name: "default" },
    { configDir: managed("work"), name: "work" },
  ]);
};

const addsATokencommandAccountAndRejectsBad = () => {
  addAccount("token", "op read op://vault/claude");
  expect(loadAccounts().at(-1)).toEqual({
    name: "token",
    tokenCommand: "op read op://vault/claude",
  });
  expect(() => addAccount("token")).toThrow(/already exists/u);
  expect(() => addAccount("Bad Name")).toThrow(/must be lowercase/u);
};

const reordersTogglesRotationAndRemovesAccountsKeeping = () =>
  runTest(
    Effect.gen(function* () {
      yield* writeAccounts([{ configDir: "~/claude-main", name: "main" }, { name: "sub" }]);
      preferAccount("sub");
      setAutoRotation("main", false);
      expect(yield* readJsonFile(accountsFile())).toEqual({
        accounts: [{ name: "sub" }, { auto: false, configDir: "~/claude-main", name: "main" }],
      });
      setAutoRotation("main", true);
      expect(loadAccounts()[1]?.auto).toBeUndefined();
      removeAccount("sub");
      expect(loadAccounts().map((account) => account.name)).toEqual(["main"]);
      expect(() => removeAccount("main")).toThrow(/must remain/u);
      expect(() => preferAccount("nope")).toThrow(/No Claude account/u);
    }),
  );

const deletesTheConfigDirMsaMadeFor = () =>
  runTest(
    Effect.gen(function* () {
      const account = addAccount("work");
      yield* makeDirectory(account.configDir!);
      blockIfUnusable(account, { cause: "usage_limit", error: "You've hit your limit" });
      removeAccount("work");
      expect(yield* pathExists(managed("work"))).toBe(false);
      expect(blockOf(account)).toBeUndefined();
    }),
  );

const signsAnAccountInWithTheCode = () =>
  runTest(
    Effect.gen(function* () {
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
            runTest(
              Effect.sync(() => {
                shown = url;
                return "the-code";
              }),
            ),
        }),
      );
      expect(shown).toBe("https://claude.com/oauth?x=1");
      expect(yield* readTextFile(joinPath(managed("work"), "token"))).toBe("the-code");
      expect(yield* awaited(authStatus(account))).toEqual({
        email: "a@example.com",
        loggedIn: true,
      });
      expect(blockOf(account)).toBeUndefined();
    }),
  );

const cancelsTheLoginWhenTheUserGives = () =>
  runTest(
    Effect.gen(function* () {
      yield* fakeClaude(`echo "visit: https://claude.com/oauth"\nread code\nexit 1`);
      const account = addAccount("work");
      yield* awaited(
        expect(
          loginAccount(account, {
            askCode: () => runTest(Effect.as(Effect.void, undefined)),
          }),
        ).rejects.toThrow(/cancelled/u),
      );
    }),
  );

const tellsLoginHowToInstallClaudeCode = () =>
  runTest(
    Effect.gen(function* () {
      vi.stubEnv("CLAUDE_BIN", "");
      vi.stubEnv("PATH", joinPath(currentAgentDir(), "empty"));
      expect(yield* awaited(claudeCodeService.status())).toEqual({
        install: "curl -fsSL https://claude.ai/install.sh | bash",
        installed: false,
      });
    }),
  );

const signsTheOnlyAccountInFromLogin = () =>
  runTest(
    Effect.gen(function* () {
      yield* fakeClaude(claudeWithLogin);
      yield* writeAccounts([{ configDir: managed("work"), name: "work" }]);
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
  );

const addsANewAccountFromLogin = () =>
  runTest(
    Effect.gen(function* () {
      yield* fakeClaude(claudeWithLogin);
      yield* writeAccounts([
        { configDir: managed("main"), name: "main" },
        { name: "token", tokenCommand: "echo token" },
        { configDir: managed("sub"), name: "sub" },
      ]);
      const ui = interaction({ prompts: ["work", "the-code"], select: "Add a new account" });
      yield* awaited(claudeCodeService.login(ui, abortController().signal));
      expect(ui.select).toHaveBeenCalledWith("Sign in which Claude account?", [
        "main",
        "sub",
        "Add a new account",
      ]);
      expect(loadAccounts().at(-1)).toEqual({ configDir: managed("work"), name: "work" });
      expect(yield* readTextFile(joinPath(managed("work"), "token"))).toBe("the-code");
    }),
  );

describe("managing Claude Code accounts", () => {
  it(
    "keeps the implicit default account when the first account is added",
    keepsTheImplicitDefaultAccountWhenThe,
  );

  it(
    "adds a tokenCommand account and rejects bad or duplicate names",
    addsATokencommandAccountAndRejectsBad,
  );

  it(
    "reorders, toggles rotation and removes accounts, keeping ~ as written",
    reordersTogglesRotationAndRemovesAccountsKeeping,
  );

  it("deletes the config dir msa made for a removed account", deletesTheConfigDirMsaMadeFor);

  it("signs an account in with the code the user pastes", signsAnAccountInWithTheCode);

  it("cancels the login when the user gives no code", cancelsTheLoginWhenTheUserGives);

  it(
    "tells /login how to install Claude Code when it is missing",
    tellsLoginHowToInstallClaudeCode,
  );

  it("signs the only account in from /login without asking which", signsTheOnlyAccountInFromLogin);

  it("adds a new account from /login when there are several", addsANewAccountFromLogin);
});
