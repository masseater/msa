import config from "../../config.ts";
import platform from "../platform/index.ts";
import type claudeAccountsTypes from "./claude-accounts.types.ts";

const { makeDirectory, readText, writeFile } = platform.files;
const { dirname, join } = platform;
const { expandTildePath, getAgentDir } = config;

type Account = claudeAccountsTypes.Account;

const configFile = () => join(getAgentDir(), "claude-code-accounts.json");
const managedDir = (name: string) => join(getAgentDir(), "claude-accounts", name);

const DEFAULT_ACCOUNTS: Account[] = [{ name: "default" }];

let snapshot: { file: string; accounts: Account[] } | undefined;

function parseAccounts(file: string, raw: string): Account[] {
  const accounts = (JSON.parse(raw) as { accounts?: Account[] }).accounts ?? [];
  if (accounts.length === 0) throw new Error(`${file} lists no accounts`);
  return accounts;
}

function readAccounts(): Promise<Account[]> {
  const file = configFile();
  return readText(file)
    .then(
      (raw) => parseAccounts(file, raw),
      () => DEFAULT_ACCOUNTS,
    )
    .then((accounts) => {
      snapshot = { accounts, file };
      return accounts;
    });
}

function withExpandedConfigDir(account: Account): Account {
  if (account.configDir === undefined || account.configDir === "") return account;
  return Object.assign({}, account, { configDir: expandTildePath(account.configDir) });
}

function loadAccounts(): Promise<Account[]> {
  return readAccounts().then((accounts) => accounts.map(withExpandedConfigDir));
}

function cachedAccounts(): Account[] {
  const accounts = snapshot?.file === configFile() ? snapshot.accounts : DEFAULT_ACCOUNTS;
  return accounts.map(withExpandedConfigDir);
}

function editAccounts(change: (accounts: Account[]) => Account[]): Promise<void> {
  const file = configFile();
  return readAccounts().then((current) => {
    const accounts = change(current);
    if (accounts.length === 0) throw new Error("At least one Claude account must remain");
    return makeDirectory({ path: dirname(file) })
      .then(() => writeFile({ data: `${JSON.stringify({ accounts }, null, 2)}\n`, path: file }))
      .then(() => {
        snapshot = { accounts, file };
        return undefined;
      });
  });
}

function findAccount(accounts: Account[], name: string): Account {
  const account = accounts.find((candidate) => candidate.name === name);
  if (account === undefined) throw new Error(`No Claude account named "${name}"`);
  return account;
}

function addAccount(name: string, tokenCommand?: string): Promise<Account> {
  if (!/^[a-z0-9][a-z0-9_-]*$/u.test(name)) {
    return Promise.reject(
      new Error(`Account name "${name}" must be lowercase letters, digits, "-" or "_"`),
    );
  }
  const account: Account =
    tokenCommand === undefined || tokenCommand === ""
      ? { configDir: managedDir(name), name }
      : { name, tokenCommand };
  return editAccounts((accounts) => {
    if (accounts.some((candidate) => candidate.name === name)) {
      throw new Error(`Claude account "${name}" already exists`);
    }
    return [...accounts, account];
  }).then(() => account);
}

function preferAccount(name: string): Promise<void> {
  return editAccounts((accounts) => {
    const account = findAccount(accounts, name);
    return [account, ...accounts.filter((candidate) => candidate !== account)];
  });
}

function withAutoRotation(account: Account, auto: boolean): Account {
  const { auto: _auto, ...rest } = account;
  return auto ? rest : Object.assign(rest, { auto: false });
}

function setAutoRotation(name: string, auto: boolean): Promise<void> {
  return editAccounts((accounts) => {
    findAccount(accounts, name);
    return accounts.map((account) =>
      account.name === name ? withAutoRotation(account, auto) : account,
    );
  });
}

const claudeAccountConfig = {
  addAccount,
  cachedAccounts,
  editAccounts,
  findAccount,
  loadAccounts,
  managedDir,
  preferAccount,
  setAutoRotation,
};

export default claudeAccountConfig;
