import configCommand from "./package-manager-cli/config-command.ts";
import packageCommand from "./package-manager-cli/package-command.ts";

const { handleConfigCommand } = configCommand;
const { handlePackageCommand } = packageCommand;

const packageManagerCli = {
  handleConfigCommand,
  handlePackageCommand,
};

export default packageManagerCli;
