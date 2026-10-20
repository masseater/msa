import config from "../../config.ts";
import nodeFs from "../platform/node/fs.ts";
import nodePath from "../platform/node/path.ts";
import type claudeAccountsTypes from "./claude-accounts.types.ts";

const { mkdirSync, readFileSync, writeFileSync } = nodeFs;
const { dirname, join } = nodePath;
const { expandTildePath, getAgentDir } = config;

type Account = claudeAccountsTypes.Account;

const configFile = () => join(getAgentDir(), "claude-code-accounts.json");
const managedDir = (name: string) => join(getAgentDir(), "claude-accounts", name);

function readAccounts(): Account[] {
  let raw: string;
  try {
    raw = readFileSync(configFile(), "utf8");
  } catch {
    return [{ name: "default" }];
  }
  const accounts = (JSON.parse(raw) as { accounts?: Account[] }).accounts ?? [];
  if (accounts.length === 0) throw new Error(`${configFile()} lists no accounts`);
  return accounts;
}

function withExpandedConfigDir(account: Account): Account {
  if (account.configDir === undefined || account.configDir === "") return account;
  return Object.assign({}, account, { configDir: expandTildePath(account.configDir) });
}

function loadAccounts(): Account[] {
  return readAccounts().map(withExpandedConfigDir);
}

function editAccounts(change: (accounts: Account[]) => Account[]): void {
  const accounts = change(readAccounts());
  if (accounts.length === 0) throw new Error("At least one Claude account must remain");
  const file = configFile();
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify({ accounts }, null, 2)}\n`);
}

function findAccount(accounts: Account[], name: string): Account {
  const account = accounts.find((candidate) => candidate.name === name);
  if (account === undefined) throw new Error(`No Claude account named "${name}"`);
  return account;
}

function addAccount(name: string, tokenCommand?: string): Account {
  if (!/^[a-z0-9][a-z0-9_-]*$/u.test(name)) {
    throw new Error(`Account name "${name}" must be lowercase letters, digits, "-" or "_"`);
  }
  const account: Account =
    tokenCommand === undefined || tokenCommand === ""
      ? { configDir: managedDir(name), name }
      : { name, tokenCommand };
  editAccounts((accounts) => {
    if (accounts.some((candidate) => candidate.name === name)) {
      throw new Error(`Claude account "${name}" already exists`);
    }
    return [...accounts, account];
  });
  return account;
}

function preferAccount(name: string): void {
  editAccounts((accounts) => {
    const account = findAccount(accounts, name);
    return [account, ...accounts.filter((candidate) => candidate !== account)];
  });
}

function withAutoRotation(account: Account, auto: boolean): Account {
  const { auto: _auto, ...rest } = account;
  return auto ? rest : Object.assign(rest, { auto: false });
}

function setAutoRotation(name: string, auto: boolean): void {
  editAccounts((accounts) => {
    findAccount(accounts, name);
    return accounts.map((account) =>
      account.name === name ? withAutoRotation(account, auto) : account,
    );
  });
}

const claudeAccountConfig = {
  addAccount,
  editAccounts,
  findAccount,
  loadAccounts,
  managedDir,
  preferAccount,
  setAutoRotation,
};

export default claudeAccountConfig;
