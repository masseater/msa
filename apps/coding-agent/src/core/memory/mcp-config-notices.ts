import configModule from "../../config.ts";
import platform from "../platform/index.ts";
import memoryModule from "./memory.ts";

const { CONFIG_DIR_NAME } = configModule;
const { join } = platform;
const { exists, readText } = platform.files;
const { ignoredMcpServerNotice, isSepiaceServer } = memoryModule;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function sepiaceEntries(path: string): Promise<string[]> {
  return exists(path)
    .then((found) => (found ? readText(path) : undefined))
    .then((content) => {
      if (content === undefined) return [];
      const parsed: unknown = JSON.parse(content);
      const servers = isRecord(parsed) ? parsed["mcpServers"] : undefined;
      if (!isRecord(servers)) return [];
      return Object.entries(servers).flatMap(([name, value]) =>
        isSepiaceServer(
          name,
          isRecord(value) && typeof value["url"] === "string" ? value["url"] : undefined,
        )
          ? [ignoredMcpServerNotice(path, name)]
          : [],
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
  return Promise.all(paths.map(sepiaceEntries)).then((notices) => notices.flat());
}

const mcpConfigNoticesModule = { mcpConfigNotices };

export default mcpConfigNoticesModule;
