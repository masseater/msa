import { Type } from "@msa/ai";
import {
  type AgentState,
  defineExtension,
  type HarnessSettings,
  type RegistrySnapshot,
  section,
  type ToolRegistration,
} from "@msa/durable";

import { resolveAgent, resolveSettings } from "../src/harness/agent.ts";

export type AppTool = ToolRegistration & { readonly snippet?: string };

export function tool(name: string, extra: Partial<AppTool> = {}): AppTool {
  return {
    name,
    description: `${name} tool`,
    parameters: Type.Object({}),
    execute: () => Promise.resolve({ output: [] }),
    ...extra,
  };
}

// Resolve `state` against `snapshot` and `settings`, collecting reports.
export function resolve(
  state: AgentState | undefined,
  snapshot: RegistrySnapshot<AppTool>,
  settings: HarnessSettings = {},
  reports: unknown[] = [],
) {
  return resolveAgent(state, snapshot, resolveSettings(settings), (error) => reports.push(error));
}

export const read = tool("read");

export const bash = tool("bash");

export const edit = tool("edit");

export const Coding = defineExtension<AppTool>({
  name: "coding",
  tools: [read, bash, edit],
  sections: [section("preamble", () => "You code.", { tag: false }), section("cwd", () => "/repo")],
});

export const Skills = defineExtension<AppTool>({
  name: "skills",
  sections: [section("skills", () => "S")],
});
