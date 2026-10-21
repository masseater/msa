import config from "../../config.ts";
import platform from "../platform/index.ts";
import claudeAccountAuth from "./claude-account-auth.ts";
import claudeAccountBlocks from "./claude-account-blocks.ts";
import claudeAccountConfig from "./claude-account-config.ts";
import type claudeAccountsTypes from "./claude-accounts.types.ts";

const { expandTildePath } = config;
const { remove } = platform.files;
const { clearBlock } = claudeAccountBlocks;
const { editAccounts, findAccount, managedDir } = claudeAccountConfig;

function isManagedConfigDir(account: claudeAccountsTypes.Account | undefined, name: string) {
  const configDir = account?.configDir;
  return (
    configDir !== undefined && configDir !== "" && expandTildePath(configDir) === managedDir(name)
  );
}

function removeAccount(name: string): Promise<void> {
  let removed: claudeAccountsTypes.Account | undefined;
  return editAccounts((accounts) => {
    removed = findAccount(accounts, name);
    return accounts.filter((candidate) => candidate !== removed);
  })
    .then(() =>
      isManagedConfigDir(removed, name)
        ? remove({ force: true, path: managedDir(name), recursive: true })
        : undefined,
    )
    .then(() => clearBlock(name));
}

const claudeAccounts = {
  accountEnv: claudeAccountAuth.accountEnv,
  addAccount: claudeAccountConfig.addAccount,
  authStatus: claudeAccountAuth.authStatus,
  blockIfUnusable: claudeAccountBlocks.blockIfUnusable,
  blockOf: claudeAccountBlocks.blockOf,
  cachedAccounts: claudeAccountConfig.cachedAccounts,
  claudeExecutable: claudeAccountAuth.claudeExecutable,
  clearBlocks: claudeAccountBlocks.clearBlocks,
  describeLogin: claudeAccountAuth.describeLogin,
  loadAccounts: claudeAccountConfig.loadAccounts,
  loginAccount: claudeAccountAuth.loginAccount,
  logoutAccount: claudeAccountAuth.logoutAccount,
  preferAccount: claudeAccountConfig.preferAccount,
  removeAccount,
  setAutoRotation: claudeAccountConfig.setAutoRotation,
  withAuthStatus: claudeAccountAuth.withAuthStatus,
};

export default claudeAccounts;
