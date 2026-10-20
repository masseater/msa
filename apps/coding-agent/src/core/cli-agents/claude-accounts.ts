import config from "../../config.ts";
import nodeFs from "../platform/node/fs.ts";
import claudeAccountAuth from "./claude-account-auth.ts";
import claudeAccountBlocks from "./claude-account-blocks.ts";
import claudeAccountConfig from "./claude-account-config.ts";
import type claudeAccountsTypes from "./claude-accounts.types.ts";

const { expandTildePath } = config;
const { rmSync } = nodeFs;
const { clearBlock } = claudeAccountBlocks;
const { editAccounts, findAccount, managedDir } = claudeAccountConfig;

function removeAccount(name: string): void {
  let removed: claudeAccountsTypes.Account | undefined;
  editAccounts((accounts) => {
    removed = findAccount(accounts, name);
    return accounts.filter((candidate) => candidate !== removed);
  });
  const configDir = removed?.configDir;
  if (
    configDir !== undefined &&
    configDir !== "" &&
    expandTildePath(configDir) === managedDir(name)
  ) {
    rmSync(managedDir(name), { force: true, recursive: true });
  }
  clearBlock(name);
}

const claudeAccounts = {
  accountEnv: claudeAccountAuth.accountEnv,
  addAccount: claudeAccountConfig.addAccount,
  authStatus: claudeAccountAuth.authStatus,
  blockIfUnusable: claudeAccountBlocks.blockIfUnusable,
  blockOf: claudeAccountBlocks.blockOf,
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
