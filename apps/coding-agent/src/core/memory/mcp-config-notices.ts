import { Predicate } from "effect";

import configModule from "../../config.ts";
import platform from "../platform/index.ts";
import memoryModule from "./memory.ts";

const { CONFIG_DIR_NAME } = configModule;
const { join } = platform;
const { exists, readText } = platform.files;
const { ignoredMcpServerNotice, isSepiaceServer, readSepiaceUrl } = memoryModule;

function sepiaceEntries(path: string, memoryUrl: string): Promise<string[]> {
  return exists(path)
    .then((found) => (found ? readText(path) : undefined))
    .then((content) => {
      if (content === undefined) return [];
      const parsed: unknown = JSON.parse(content);
      const servers = Predicate.isObject(parsed) ? parsed["mcpServers"] : undefined;
      if (!Predicate.isObject(servers)) return [];
      return Object.entries(servers).flatMap(([name, value]) =>
        isSepiaceServer(name, value, memoryUrl) ? [ignoredMcpServerNotice(path, name)] : [],
      );
    })
    .catch(() => []);
}

function mcpConfigNotices(options: {
  readonly agentDir: string;
  readonly cwd: string;
  readonly projectTrusted: boolean;
}): Promise<string[]> {
  const paths = [
    join(options.agentDir, "mcp.json"),
    ...(options.projectTrusted ? [join(options.cwd, CONFIG_DIR_NAME, "mcp.json")] : []),
  ];
  return readSepiaceUrl(options)
    .then((memoryUrl) => Promise.all(paths.map((path) => sepiaceEntries(path, memoryUrl))))
    .then((notices) => notices.flat());
}

const mcpConfigNoticesModule = { mcpConfigNotices };

export default mcpConfigNoticesModule;
