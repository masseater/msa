import { Type } from "@msa/ai";
import {
  type AgentState,
  defineExtension,
  type HarnessSettings,
  type RegistrySnapshot,
  section,
  type ToolRegistration,
} from "@msa/durable";
import { dual } from "effect/Function";

import { resolveAgent, resolveSettings } from "../src/harness/agent.ts";

export type AppTool = ToolRegistration & { readonly snippet?: string };

function toolImpl(name: string, extra: Partial<AppTool> = {}): AppTool {
  return {
    name,
    description: `${name} tool`,
    parameters: Type.Object({}),
    execute: () => Promise.resolve({ output: [] }),
    ...extra,
  };
}

export const tool: {
  (extra?: Partial<AppTool>): (name: string) => ReturnType<typeof toolImpl>;
  (name: string, extra?: Partial<AppTool>): ReturnType<typeof toolImpl>;
} = dual((args) => typeof args[0] === "string", toolImpl);

function resolveImpl(
  state: AgentState | undefined,
  snapshot: RegistrySnapshot<AppTool>,
  settings: HarnessSettings = {},
  reports: unknown[] = [],
) {
  return resolveAgent(state, snapshot, resolveSettings(settings), (error) => reports.push(error));
}

export const resolve: {
  (
    snapshot: RegistrySnapshot<AppTool>,
    settings?: HarnessSettings,
    reports?: unknown[],
  ): (state: AgentState | undefined) => ReturnType<typeof resolveImpl>;
  (
    state: AgentState | undefined,
    snapshot: RegistrySnapshot<AppTool>,
    settings?: HarnessSettings,
    reports?: unknown[],
  ): ReturnType<typeof resolveImpl>;
} = dual(
  (args) => args.length >= 2 && args[1] !== undefined && "installed" in args[1],
  resolveImpl,
);

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
