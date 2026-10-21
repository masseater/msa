import childProcess from "../../utils/child-process.ts";
import shell from "../../utils/shell.ts";
import platformModule from "../platform/index.ts";
import nodeChildProcess from "../platform/node/child-process.ts";
import nodeUtil from "../platform/node/util.ts";
import claudeAccountBlocks from "./claude-account-blocks.ts";
import type claudeAccountsTypes from "./claude-accounts.types.ts";

const { promisify } = nodeUtil;

const { envSnapshot, readEnv } = platformModule;
const { spawnProcess, waitForChildProcess } = childProcess;
const { findExecutableOnPath } = shell;
const { execFile } = nodeChildProcess;
const { makeDirectory } = platformModule.files;
const { clearBlock } = claudeAccountBlocks;

type Account = claudeAccountsTypes.Account;
type AuthStatus = claudeAccountsTypes.AuthStatus;

const execFileText = promisify(execFile);
const tokens = new Map<string, Promise<string>>();

const nonEmpty = (value: string | null | undefined): string | undefined =>
  value === null || value === undefined || value === "" ? undefined : value;

function claudeExecutable(): string | undefined {
  return nonEmpty(readEnv("CLAUDE_BIN")?.trim()) ?? nonEmpty(findExecutableOnPath("claude"));
}

const lastLine = (text: string, fallback: string): string =>
  nonEmpty(text.split("\n").at(-1)) ?? fallback;

const runTokenCommand = (command: string): Promise<string> =>
  execFileText(nonEmpty(readEnv("SHELL")) ?? "/bin/sh", ["-c", command]).then(
    ({ stdout }) => {
      const token = stdout.trim();
      if (token === "") throw new Error(`tokenCommand ${command}: printed nothing`);
      return token;
    },
    (error: unknown) => {
      const stderr = String((error as { stderr?: unknown }).stderr ?? "").trim();
      throw new Error(`tokenCommand ${command}: ${lastLine(stderr, "failed")}`, { cause: error });
    },
  );

function cachedToken(command: string): Promise<string> {
  const cached = tokens.get(command);
  if (cached !== undefined) return cached;
  const token = runTokenCommand(command);
  tokens.set(command, token);
  token.catch(() => tokens.delete(command));
  return token;
}

function accountEnv(account: Account): Promise<Record<string, string>> {
  const env = { ...envSnapshot() } as Record<string, string>;
  delete env["CLAUDECODE"];
  const configDir = nonEmpty(account.configDir);
  const command = nonEmpty(account.tokenCommand);
  if (configDir !== undefined || command !== undefined) delete env["CLAUDE_CODE_OAUTH_TOKEN"];
  if (configDir !== undefined) env["CLAUDE_CONFIG_DIR"] = configDir;
  if (command === undefined) return Promise.resolve(env);
  return cachedToken(command).then((token) => {
    env["CLAUDE_CODE_OAUTH_TOKEN"] = token;
    return env;
  });
}

function describeLogin(status: AuthStatus): string {
  if (!status.loggedIn) return "";
  const email = nonEmpty(status.email);
  return email === undefined ? "logged in" : `logged in as ${email}`;
}

function statusFromError(error: unknown): AuthStatus {
  const stdout = String((error as { stdout?: unknown }).stdout ?? "");
  try {
    if ((JSON.parse(stdout) as { loggedIn?: boolean }).loggedIn === false)
      return { loggedIn: false };
  } catch {}
  return {
    detail: error instanceof Error ? (error.message.split("\n")[0] ?? "") : String(error),
    loggedIn: false,
  };
}

const authStatus = (account: Account): Promise<AuthStatus> =>
  accountEnv(account)
    .then((env) =>
      execFileText(claudeExecutable() ?? "claude", ["auth", "status"], { env, timeout: 15_000 }),
    )
    .then(({ stdout }) => {
      const status = JSON.parse(stdout) as { loggedIn?: boolean; email?: string };
      const email = nonEmpty(status.email);
      return { loggedIn: status.loggedIn === true, ...(email === undefined ? {} : { email }) };
    })
    .catch(statusFromError);

const withAuthStatus = (accounts: Account[]) =>
  Promise.all(accounts.map((account) => authStatus(account))).then((statuses) =>
    accounts.map((account, index) => ({ account, status: statuses[index]! })),
  );

function runLogin(
  account: Account,
  prompts: claudeAccountsTypes.LoginPrompts,
  env: Record<string, string>,
): Promise<void> {
  const child = spawnProcess(claudeExecutable() ?? "claude", ["auth", "login"], {
    env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const exited = new AbortController();
  const state = { asked: false, cancelled: false, output: "" };
  const answer = (code: string | undefined) => {
    if (exited.signal.aborted) return;
    const trimmed = code?.trim() ?? "";
    if (trimmed === "") {
      state.cancelled = true;
      child.kill();
    } else child.stdin.write(`${trimmed}\n`);
  };
  const onOutput = (chunk: Buffer) => {
    state.output = (state.output + String(chunk)).slice(-4000);
    const url = /https:\/\/\S+/u.exec(state.output)?.[0];
    if (state.asked || url === undefined) return;
    if (!/\r?\n/u.test(state.output.slice(state.output.indexOf(url)))) return;
    state.asked = true;
    prompts.askCode(url, exited.signal).then(answer, () => undefined);
  };
  child.stdout.on("data", onOutput);
  child.stderr.on("data", onOutput);
  return waitForChildProcess(child).then((code) => {
    exited.abort();
    if (state.cancelled) throw new Error(`Login for "${account.name}" cancelled`);
    if (code === 0) return;
    const lines = state.output
      .trim()
      .split("\n")
      .filter((line) => !line.includes("https://"));
    throw new Error(`claude auth login failed: ${lastLine(lines.join("\n"), `exit ${code}`)}`);
  });
}

function loginAccount(account: Account, prompts: claudeAccountsTypes.LoginPrompts): Promise<void> {
  const configDir = nonEmpty(account.configDir);
  if (configDir === undefined && nonEmpty(account.tokenCommand) !== undefined) {
    return Promise.reject(
      new Error(`"${account.name}" signs in with its tokenCommand, not a Claude login`),
    );
  }
  return (configDir === undefined ? Promise.resolve() : makeDirectory({ path: configDir }))
    .then(() => accountEnv(account))
    .then((env) => runLogin(account, prompts, env))
    .then(() => clearBlock(account.name));
}

const logoutAccount = (account: Account): Promise<void> =>
  accountEnv(account)
    .then((env) =>
      execFileText(claudeExecutable() ?? "claude", ["auth", "logout"], { env, timeout: 15_000 }),
    )
    .then(() => undefined);

const claudeAccountAuth = {
  accountEnv,
  authStatus,
  claudeExecutable,
  describeLogin,
  loginAccount,
  logoutAccount,
  withAuthStatus,
};

export default claudeAccountAuth;
