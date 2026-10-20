import { Type } from "@msa/ai";
import {
  type AgentState,
  type HarnessSettings,
  type RegistrySnapshot,
  defineExtension,
  section,
} from "@msa/durable";
import { dual } from "effect/Function";

import { resolveAgent, resolveSettings } from "../src/harness/agent.ts";
import type harnessRegistrySupportTypes from "./harness-registry-support.types.ts";

function toolImpl(
  name: string,
  extra: Partial<harnessRegistrySupportTypes.AppTool> = {},
): harnessRegistrySupportTypes.AppTool {
  return {
    description: `${name} tool`,
    execute: () => Promise.resolve({ output: [] }),
    name,
    parameters: Type.Object({}),
    ...extra,
  };
}

const tool: {
  (
    extra?: Partial<harnessRegistrySupportTypes.AppTool>,
  ): (name: string) => ReturnType<typeof toolImpl>;
  (name: string, extra?: Partial<harnessRegistrySupportTypes.AppTool>): ReturnType<typeof toolImpl>;
} = dual((args) => typeof args[0] === "string", toolImpl);

function resolveImpl(
  state: AgentState | undefined,
  snapshot: RegistrySnapshot<harnessRegistrySupportTypes.AppTool>,
  settings: HarnessSettings = {},
  reports: unknown[] = [],
) {
  return resolveAgent(state, snapshot, resolveSettings(settings), (error) => reports.push(error));
}

const resolve: {
  (
    snapshot: RegistrySnapshot<harnessRegistrySupportTypes.AppTool>,
    settings?: HarnessSettings,
    reports?: unknown[],
  ): (state: AgentState | undefined) => ReturnType<typeof resolveImpl>;
  (
    state: AgentState | undefined,
    snapshot: RegistrySnapshot<harnessRegistrySupportTypes.AppTool>,
    settings?: HarnessSettings,
    reports?: unknown[],
  ): ReturnType<typeof resolveImpl>;
} = dual(
  (args) => args.length >= 2 && args[1] !== undefined && "installed" in args[1],
  resolveImpl,
);

const read = tool("read");

const bash = tool("bash");

const edit = tool("edit");

const Coding = defineExtension<harnessRegistrySupportTypes.AppTool>({
  name: "coding",
  sections: [section("preamble", () => "You code.", { tag: false }), section("cwd", () => "/repo")],
  tools: [read, bash, edit],
});

const Skills = defineExtension<harnessRegistrySupportTypes.AppTool>({
  name: "skills",
  sections: [section("skills", () => "S")],
});

const harnessRegistrySupport = {
  Coding,
  Skills,
  bash,
  edit,
  read,
  resolve,
  tool,
};

export default harnessRegistrySupport;
