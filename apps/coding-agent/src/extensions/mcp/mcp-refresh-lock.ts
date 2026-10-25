import directoryLock from "../../core/directory-lock.ts";
import platform from "../../core/platform/index.ts";

const { sha256Hex } = platform;
const { withDirectoryLock } = directoryLock;

const withRefreshLock = <T>(
  lockDir: string | undefined,
  key: string,
  fn: () => Promise<T>,
): Promise<T> => withDirectoryLock(lockDir, `mcp-auth-refresh-${sha256Hex(key).slice(0, 16)}`, fn);

const mcpRefreshLock = { withRefreshLock };

export default mcpRefreshLock;
