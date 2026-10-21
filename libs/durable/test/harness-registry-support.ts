import ai from "@msa/ai";
import durable from "@msa/durable";
import type durableTypes from "@msa/durable/index.types";
import { dual } from "effect/Function";

import agentModule from "../src/harness/agent.ts";
import type harnessRegistrySupportTypes from "./harness-registry-support.types.ts";

const { Type } = ai;

const { resolveAgent, resolveSettings } = agentModule;
const { defineExtension, section } = durable;

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
  state: durableTypes.AgentState | undefined,
  snapshot: durableTypes.RegistrySnapshot<harnessRegistrySupportTypes.AppTool>,
  settings: durableTypes.HarnessSettings = {},
  reports: unknown[] = [],
) {
  return resolveAgent(state, snapshot, resolveSettings(settings), (error) => reports.push(error));
}

const resolve: {
  (
    snapshot: durableTypes.RegistrySnapshot<harnessRegistrySupportTypes.AppTool>,
    settings?: durableTypes.HarnessSettings,
    reports?: unknown[],
  ): (state: durableTypes.AgentState | undefined) => ReturnType<typeof resolveImpl>;
  (
    state: durableTypes.AgentState | undefined,
    snapshot: durableTypes.RegistrySnapshot<harnessRegistrySupportTypes.AppTool>,
    settings?: durableTypes.HarnessSettings,
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
