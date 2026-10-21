import config from "../config.ts";
import paths from "../utils/paths.ts";
import platformModule from "./platform/index.ts";
import nodeOs from "./platform/node/os.ts";
import type trustManagerTypes from "./trust-manager.types.ts";

const { homedir } = nodeOs;

const { canonicalizePath, resolvePath } = paths;
const { dirname, join, readEnv } = platformModule;
const { exists } = platformModule.files;
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
function normalizeCwd(cwd: string): Promise<string> {
  return canonicalizePath(resolvePath(cwd));
}
const parentOf = (trustPath: string): string | undefined => {
  const parentDir = dirname(trustPath);
  return parentDir === trustPath ? undefined : parentDir;
};
function getProjectTrustParentPath(cwd: string): Promise<string | undefined> {
  return normalizeCwd(cwd).then(parentOf);
}
function getProjectTrustOptions(
  cwd: string,
  options?: { includeSessionOnly?: boolean },
): Promise<trustManagerTypes.ProjectTrustOption[]> {
  return normalizeCwd(cwd).then((trustPath) => trustOptionsFor(trustPath, options));
}
function trustOptionsFor(
  trustPath: string,
  options: { includeSessionOnly?: boolean } | undefined,
): trustManagerTypes.ProjectTrustOption[] {
  const trustOptions: trustManagerTypes.ProjectTrustOption[] = [
    {
      label: "Trust",
      savedPath: trustPath,
      trusted: true,
      updates: [{ decision: true, path: trustPath }],
    },
  ];
  const parentPath = parentOf(trustPath);
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
const hasProjectConfigResource = (dir: string): Promise<boolean> => {
  const configDir = join(dir, CONFIG_DIR_NAME);
  return Promise.all(
    TRUST_REQUIRING_PROJECT_CONFIG_RESOURCES.map((entry) => exists(join(configDir, entry))),
  ).then((found) => found.includes(true));
};

function hasAncestorAgentsSkills(
  currentDir: string,
  userAgentsSkillsDir: string,
): Promise<boolean> {
  const agentsSkillsDir = join(currentDir, ".agents", "skills");
  const own =
    agentsSkillsDir === userAgentsSkillsDir ? Promise.resolve(false) : exists(agentsSkillsDir);
  return own.then((found) => {
    if (found) return true;
    const parentDir = dirname(currentDir);
    return parentDir === currentDir
      ? false
      : hasAncestorAgentsSkills(parentDir, userAgentsSkillsDir);
  });
}

function hasTrustRequiringProjectResources(cwd: string): Promise<boolean> {
  return Promise.all([
    canonicalizePath(resolvePath(readEnv("HOME") || homedir())),
    canonicalizePath(resolvePath(cwd)),
  ]).then(([homeDir, currentDir]) =>
    hasProjectConfigResource(currentDir).then((found) =>
      found ? true : hasAncestorAgentsSkills(currentDir, join(homeDir, ".agents", "skills")),
    ),
  );
}

const trustManager = {
  getProjectTrustOptions,
  getProjectTrustParentPath,
  hasTrustRequiringProjectResources,
  normalizeCwd,
};

export default trustManager;
