import platformModule from "./platform/index.ts";
import nodeFs from "./platform/node/fs.ts";

const { chmodSync, mkdirSync } = nodeFs;
const { join } = platformModule;

function getExtensionTempFolder(agentDir: string): string {
  const tempFolder = join(agentDir, "tmp", "extensions");
  mkdirSync(tempFolder, { mode: 0o700, recursive: true });
  chmodSync(tempFolder, 0o700);
  return tempFolder;
}

const packageManager = {
  getExtensionTempFolder,
};

export default packageManager;
