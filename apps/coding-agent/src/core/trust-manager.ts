import { homedir } from "node:os";

import config from "../config.ts";
import paths from "../utils/paths.ts";
import platformNode from "./platform-node.ts";
import nodeFs from "./platform/node/fs.ts";
import processEnv from "./process-env.ts";
import type trustManagerTypes from "./trust-manager.types.ts";

const { existsSync } = nodeFs;
const { canonicalizePath, resolvePath } = paths;
const { dirname, join } = platformNode;
const { readEnv } = processEnv;
const { CONFIG_DIR_NAME } = config;

const TRUST_REQUIRING_PROJECT_CONFIG_RESOURCES = [
  "settings.json",
  "mcp.json",
  "extensions",
  "skills",
  "prompts",
  "themes",
  "SYSTEM.md",
  "APPEND_SYSTEM.md",
] as const;
function normalizeCwd(cwd: string): string {
  return canonicalizePath(resolvePath(cwd));
}
function getProjectTrustParentPath(cwd: string): string | undefined {
  const trustPath = normalizeCwd(cwd);
  const parentDir = dirname(trustPath);
  return parentDir === trustPath ? undefined : parentDir;
}
function getProjectTrustOptions(
  cwd: string,
  options?: { includeSessionOnly?: boolean },
): trustManagerTypes.ProjectTrustOption[] {
  const trustPath = normalizeCwd(cwd);
  const trustOptions: trustManagerTypes.ProjectTrustOption[] = [
    {
      label: "Trust",
      savedPath: trustPath,
      trusted: true,
      updates: [{ decision: true, path: trustPath }],
    },
  ];
  const parentPath = getProjectTrustParentPath(cwd);
  if (parentPath !== undefined) {
    trustOptions.push({
      label: `Trust parent folder (${parentPath})`,
      savedPath: parentPath,
      trusted: true,
      updates: [
        { decision: true, path: parentPath },
        { decision: null, path: trustPath },
      ],
    });
  }
  if (options?.includeSessionOnly === true) {
    trustOptions.push({ label: "Trust (this session only)", trusted: true, updates: [] });
  }
  trustOptions.push({
    label: "Do not trust",
    savedPath: trustPath,
    trusted: false,
    updates: [{ decision: false, path: trustPath }],
  });
  if (options?.includeSessionOnly === true) {
    trustOptions.push({ label: "Do not trust (this session only)", trusted: false, updates: [] });
  }
  return trustOptions;
}
function hasTrustRequiringProjectResources(cwd: string): boolean {
  const homeDir = canonicalizePath(resolvePath(readEnv("HOME") || homedir()));
  const userAgentsSkillsDir = join(homeDir, ".agents", "skills");
  let currentDir = canonicalizePath(resolvePath(cwd));

  const configDir = join(currentDir, CONFIG_DIR_NAME);
  if (
    TRUST_REQUIRING_PROJECT_CONFIG_RESOURCES.some((entry) => existsSync(join(configDir, entry)))
  ) {
    return true;
  }

  while (true) {
    const agentsSkillsDir = join(currentDir, ".agents", "skills");
    if (agentsSkillsDir !== userAgentsSkillsDir && existsSync(agentsSkillsDir)) {
      return true;
    }

    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) {
      return false;
    }
    currentDir = parentDir;
  }
}

const trustManager = {
  getProjectTrustOptions,
  getProjectTrustParentPath,
  hasTrustRequiringProjectResources,
  normalizeCwd,
};

export default trustManager;
