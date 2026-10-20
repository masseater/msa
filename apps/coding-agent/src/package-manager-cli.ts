import packageManagerCliPart12 from "./package-manager-cli-part12.ts";
import packageManagerCliPart14 from "./package-manager-cli-part14.ts";

const { handleConfigCommand } = packageManagerCliPart12;
const { handlePackageCommand } = packageManagerCliPart14;

const packageManagerCli = {
  handleConfigCommand,
  handlePackageCommand,
};

export default packageManagerCli;
