import { NodeServices } from "@effect/platform-node";
import { CONFIG_DIR_NAME, getAgentDir, parseFrontmatter } from "@msa/coding-agent";
import { Effect, FileSystem, ManagedRuntime, Option, Path } from "effect";
import { dual } from "effect/Function";

const runtime = ManagedRuntime.make(NodeServices.layer);
const pathService = runtime.runSync(Path.Path);

export const joinPath = (...segments: string[]): string => pathService.join(...segments);
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

const readAgentFile = (filePath: string, source: "user" | "project") =>
  Effect.gen(function* () {
    const content = yield* fsService.readFileString(filePath).pipe(Effect.option);
    if (Option.isNone(content)) return undefined;
    const { frontmatter, body } = parseFrontmatter<AgentFrontmatter>(content.value);
    if (typeof frontmatter.name !== "string" || typeof frontmatter.description !== "string") {
      return undefined;
    }
    const agent: AgentConfig = {
      description: frontmatter.description,
      filePath,
      model: typeof frontmatter.model === "string" ? frontmatter.model : undefined,
      name: frontmatter.name,
      source,
      systemPrompt: body,
      tools: parseToolList(frontmatter.tools),
    };
    return agent;
  });

const loadAgentsFromDir = (dir: string, source: "user" | "project") =>
  Effect.gen(function* () {
    const names = yield* fsService.readDirectory(dir).pipe(Effect.orElseSucceed(() => []));
    const agents = yield* Effect.forEach(
      names.filter((name) => name.endsWith(".md")),
      (name) => readAgentFile(pathService.join(dir, name), source),
    );
    return agents.filter((agent): agent is AgentConfig => agent !== undefined);
  });

const isDirectory = (p: string) =>
  fsService.stat(p).pipe(
    Effect.map((info) => info.type === "Directory"),
    Effect.orElseSucceed(() => false),
  );

const findNearestProjectAgentsDir = (cwd: string) =>
  Effect.gen(function* () {
    let currentDir = cwd;
    for (;;) {
      const candidate = pathService.join(currentDir, CONFIG_DIR_NAME, "agents");
      if (yield* isDirectory(candidate)) return candidate;
      const parentDir = pathService.dirname(currentDir);
      if (parentDir === currentDir) return null;
      currentDir = parentDir;
    }
  });

const discoverAgentsImpl = (cwd: string, scope: AgentScope) =>
  Effect.gen(function* () {
    const userDir = pathService.join(getAgentDir(), "agents");
    const projectAgentsDir = yield* findNearestProjectAgentsDir(cwd);
    const userAgents = scope === "project" ? [] : yield* loadAgentsFromDir(userDir, "user");
    const projectAgents =
      scope === "user" || projectAgentsDir === null || projectAgentsDir.length === 0
        ? []
        : yield* loadAgentsFromDir(projectAgentsDir, "project");

    const agentMap = new Map<string, AgentConfig>();
    if (scope !== "project") for (const agent of userAgents) agentMap.set(agent.name, agent);
    if (scope !== "user") for (const agent of projectAgents) agentMap.set(agent.name, agent);
    const result: AgentDiscoveryResult = {
      agents: Array.from(agentMap.values()),
      projectAgentsDir,
    };
    return result;
  });

export const discoverAgents: {
  (cwd: string, scope: AgentScope): Effect.Effect<AgentDiscoveryResult>;
  (scope: AgentScope): (cwd: string) => Effect.Effect<AgentDiscoveryResult>;
} = dual(2, discoverAgentsImpl);

function formatAgentListImpl(
  agents: AgentConfig[],
  maxItems: number,
): { text: string; remaining: number } {
  if (agents.length === 0) return { remaining: 0, text: "none" };
  const listed = agents.slice(0, maxItems);
  const remaining = agents.length - listed.length;
  return {
    remaining,
    text: listed.map((a) => `${a.name} (${a.source}): ${a.description}`).join("; "),
  };
}

export const formatAgentList: {
  (agents: AgentConfig[], maxItems: number): { text: string; remaining: number };
  (maxItems: number): (agents: AgentConfig[]) => { text: string; remaining: number };
} = dual(2, formatAgentListImpl);
