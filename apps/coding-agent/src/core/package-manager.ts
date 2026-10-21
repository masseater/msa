import platformModule from "./platform/index.ts";

const { join } = platformModule;
const { chmod, makeDirectory } = platformModule.files;

const PRIVATE_DIRECTORY_MODE = 0o700;

function getExtensionTempFolder(agentDir: string): string {
  return join(agentDir, "tmp", "extensions");
}

function ensureExtensionTempFolder(agentDir: string): Promise<void> {
  const tempFolder = getExtensionTempFolder(agentDir);
  return makeDirectory({ mode: PRIVATE_DIRECTORY_MODE, path: tempFolder }).then(() =>
    chmod({ mode: PRIVATE_DIRECTORY_MODE, path: tempFolder }),
  );
}

const packageManager = {
  ensureExtensionTempFolder,
  getExtensionTempFolder,
};

export default packageManager;
