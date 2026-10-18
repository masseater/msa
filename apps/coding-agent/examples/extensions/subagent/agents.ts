import { NodeServices } from "@effect/platform-node";
import { CONFIG_DIR_NAME, getAgentDir, parseFrontmatter } from "@msa/coding-agent";
import { Effect, FileSystem, ManagedRuntime, Option, Path } from "effect";
import { dual } from "effect/Function";

const runtime = ManagedRuntime.make(NodeServices.layer);
const pathService = runtime.runSync(Path.Path);
const fsService = runtime.runSync(FileSystem.FileSystem);

export type AgentScope = "user" | "project" | "both";

export interface AgentConfig {
  name: string;
  description: string;
  tools?: string[] | undefined;
  model?: string | undefined;
  systemPrompt: string;
  source: "user" | "project";
  filePath: string;
}

export interface AgentDiscoveryResult {
  agents: AgentConfig[];
  projectAgentsDir: string | null;
}

type AgentFrontmatter = {
  name?: unknown;
  description?: unknown;
  tools?: unknown;
  model?: unknown;
};

function parseToolList(value: unknown): string[] | undefined {
  const raw = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
  const tools = raw
    .filter((t): t is string => typeof t === "string")
    .map((t) => t.trim())
    .filter(Boolean);
  return tools.length > 0 ? tools : undefined;
}

function loadAgentsFromDir(dir: string, source: "user" | "project"): AgentConfig[] {
  const agents: AgentConfig[] = [];

  if (!runtime.runSync(fsService.exists(dir))) {
    return agents;
  }

  let names: string[];
  try {
    names = runtime.runSync(fsService.readDirectory(dir));
  } catch {
    return agents;
  }

  for (const name of names) {
    if (!name.endsWith(".md")) continue;

    const filePath = pathService.join(dir, name);
    let content: string;
    try {
      content = runtime.runSync(fsService.readFileString(filePath));
    } catch {
      continue;
    }

    const { frontmatter, body } = parseFrontmatter<AgentFrontmatter>(content);

    if (typeof frontmatter.name !== "string" || typeof frontmatter.description !== "string") {
      continue;
    }

    agents.push({
      name: frontmatter.name,
      description: frontmatter.description,
      tools: parseToolList(frontmatter.tools),
      model: typeof frontmatter.model === "string" ? frontmatter.model : undefined,
      systemPrompt: body,
      source,
      filePath,
    });
  }

  return agents;
}

function isDirectory(p: string): boolean {
  const info = runtime.runSync(fsService.stat(p).pipe(Effect.option));
  return Option.isSome(info) && info.value.type === "Directory";
}

function findNearestProjectAgentsDir(cwd: string): string | null {
  let currentDir = cwd;
  while (true) {
    const candidate = pathService.join(currentDir, CONFIG_DIR_NAME, "agents");
    if (isDirectory(candidate)) return candidate;

    const parentDir = pathService.dirname(currentDir);
    if (parentDir === currentDir) return null;
    currentDir = parentDir;
  }
}

function discoverAgentsImpl(cwd: string, scope: AgentScope): AgentDiscoveryResult {
  const userDir = pathService.join(getAgentDir(), "agents");
  const projectAgentsDir = findNearestProjectAgentsDir(cwd);

  const userAgents = scope === "project" ? [] : loadAgentsFromDir(userDir, "user");
  const projectAgents =
    scope === "user" || projectAgentsDir === null || projectAgentsDir.length === 0
      ? []
      : loadAgentsFromDir(projectAgentsDir, "project");

  const agentMap = new Map<string, AgentConfig>();

  if (scope === "both") {
    for (const agent of userAgents) agentMap.set(agent.name, agent);
    for (const agent of projectAgents) agentMap.set(agent.name, agent);
  } else if (scope === "user") {
    for (const agent of userAgents) agentMap.set(agent.name, agent);
  } else {
    for (const agent of projectAgents) agentMap.set(agent.name, agent);
  }

  return { agents: Array.from(agentMap.values()), projectAgentsDir };
}

export const discoverAgents: {
  (cwd: string, scope: AgentScope): AgentDiscoveryResult;
  (scope: AgentScope): (cwd: string) => AgentDiscoveryResult;
} = dual(2, discoverAgentsImpl);

function formatAgentListImpl(
  agents: AgentConfig[],
  maxItems: number,
): { text: string; remaining: number } {
  if (agents.length === 0) return { text: "none", remaining: 0 };
  const listed = agents.slice(0, maxItems);
  const remaining = agents.length - listed.length;
  return {
    text: listed.map((a) => `${a.name} (${a.source}): ${a.description}`).join("; "),
    remaining,
  };
}

export const formatAgentList: {
  (agents: AgentConfig[], maxItems: number): { text: string; remaining: number };
  (maxItems: number): (agents: AgentConfig[]) => { text: string; remaining: number };
} = dual(2, formatAgentListImpl);
