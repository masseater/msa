import { NodeServices } from "@effect/platform-node";
import codingAgent from "@msa/coding-agent";
import { Effect, FileSystem, ManagedRuntime, Option, Path } from "effect";
import { dual } from "effect/Function";

import type agentsTypes from "./agents.types.ts";

const { CONFIG_DIR_NAME, getAgentDir, parseFrontmatter } = codingAgent;

const runtime = ManagedRuntime.make(NodeServices.layer);
const pathService = runtime.runSync(Path.Path);

const joinPath = (...segments: string[]): string => pathService.join(...segments);
const fsService = runtime.runSync(FileSystem.FileSystem);

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
    const agent: agentsTypes.AgentConfig = {
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
    return agents.filter((agent): agent is agentsTypes.AgentConfig => agent !== undefined);
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

const discoverAgentsImpl = (cwd: string, scope: agentsTypes.AgentScope) =>
  Effect.gen(function* () {
    const userDir = pathService.join(getAgentDir(), "agents");
    const projectAgentsDir = yield* findNearestProjectAgentsDir(cwd);
    const userAgents = scope === "project" ? [] : yield* loadAgentsFromDir(userDir, "user");
    const projectAgents =
      scope === "user" || projectAgentsDir === null || projectAgentsDir.length === 0
        ? []
        : yield* loadAgentsFromDir(projectAgentsDir, "project");

    const agentMap = new Map<string, agentsTypes.AgentConfig>();
    if (scope !== "project") for (const agent of userAgents) agentMap.set(agent.name, agent);
    if (scope !== "user") for (const agent of projectAgents) agentMap.set(agent.name, agent);
    const result: agentsTypes.AgentDiscoveryResult = {
      agents: Array.from(agentMap.values()),
      projectAgentsDir,
    };
    return result;
  });

const discoverAgents: {
  (cwd: string, scope: agentsTypes.AgentScope): Effect.Effect<agentsTypes.AgentDiscoveryResult>;
  (scope: agentsTypes.AgentScope): (cwd: string) => Effect.Effect<agentsTypes.AgentDiscoveryResult>;
} = dual(2, discoverAgentsImpl);

function formatAgentListImpl(
  agents: agentsTypes.AgentConfig[],
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

const formatAgentList: {
  (agents: agentsTypes.AgentConfig[], maxItems: number): { text: string; remaining: number };
  (maxItems: number): (agents: agentsTypes.AgentConfig[]) => { text: string; remaining: number };
} = dual(2, formatAgentListImpl);

const agents = {
  discoverAgents,
  formatAgentList,
  joinPath,
};

export default agents;
