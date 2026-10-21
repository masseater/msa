import durable from "@msa/durable";
import harness from "@msa/durable/harness";
import type durableTypes from "@msa/durable/index.types";
import { describe, expect, it } from "vite-plus/test";

import agentModule from "../src/harness/agent.ts";
import harnessRegistryCases from "./harness-registry-cases.ts";
import harnessRegistrySupport from "./harness-registry-support.ts";
import type harnessRegistrySupportTypes from "./harness-registry-support.types.ts";

const { defineExtension, defineTask, section, wrapSection, wrapTool } = durable;
const { CompactionTask, GenerationTask, ToolTask, createRegistry } = harness;
const { resolveSettings } = agentModule;

const { names, snapshot } = harnessRegistryCases;
const { Coding, Skills, bash, edit, read, resolve, tool } = harnessRegistrySupport;

function task(name: string, version = 1) {
  return defineTask<undefined, { phase: "run" }, null>({
    abort: () => Promise.resolve(),
    initial: () => ({ phase: "run" }),
    name,
    phases: { run: () => Promise.resolve() },
    version,
  });
}

describe("registry", () => {
  it("installs, replaces in place, and uninstalls extensions by name", () => {
    const registry = createRegistry<harnessRegistrySupportTypes.AppTool>();
    const listener: string[] = [];
    registry.subscribe(() => listener.push(names(registry.snapshot().installed()).join(",")));
    const a = defineExtension<harnessRegistrySupportTypes.AppTool>({
      name: "a",
      tools: [tool("read", { snippet: "Read files" })],
    });
    const b = defineExtension<harnessRegistrySupportTypes.AppTool>({
      name: "b",
      tools: [tool("read"), tool("bash")],
    });
    registry.install(a);
    registry.install(b);
    const before = registry.snapshot();
    const a2 = defineExtension<harnessRegistrySupportTypes.AppTool>({
      name: "a",
      tools: [tool("grep")],
    });
    registry.install(a2);
    expect(names(registry.snapshot().installed())).toEqual(["a", "b"]);
    expect(registry.snapshot().extension("a")).toBe(a2);
    expect(
      registry
        .snapshot()
        .tools()
        .map(({ extension, tool: toolInner }) => `${toolInner.name}@${extension.name}`),
    ).toEqual(["grep@a", "read@b", "bash@b"]);
    expect(before.extension("a")).toBe(a);
    expect(before.tools()[0]!.tool.snippet).toBe("Read files");
    registry.uninstall(a);
    registry.uninstall(a);
    expect(names(registry.snapshot().installed())).toEqual(["b"]);
    registry.install(a);
    expect(names(registry.snapshot().installed())).toEqual(["b", "a"]);
    expect(listener).toEqual(["a", "a,b", "a,b", "b", "b,a"]);
  });
});

describe("registry", () => {
  it("validates the registry as it would be after an install and publishes nothing when invalid", () => {
    const registry = createRegistry();
    const Tasks = defineExtension({ name: "tasks", tasks: [task("app.index")] });
    registry.install(Tasks);
    const published: number[] = [];
    registry.subscribe(() => published.push(1));
    const before = registry.snapshot();
    const invalid = [
      [defineExtension({ name: "x", tools: [tool("read"), tool("read")] }), "two tools named read"],
      [
        defineExtension({
          name: "x",
          sections: [section("a", () => "1"), section("a", () => "2")],
        }),
        "two sections",
      ],
      [defineExtension({ name: "x", sections: [section("Bad Key", () => "")] }), "must match"],
      [defineExtension({ name: "x", sections: [section("instructions", () => "")] }), "reserved"],
      [defineExtension({ name: "x", tasks: [task("msa.generation")] }), "already installed"],
      [defineExtension({ name: "x", tasks: [task("app.index")] }), "already installed"],
    ] as const;
    for (const [extension, message] of invalid)
      expect(() => registry.install(extension)).toThrow(message);
    expect(registry.snapshot()).toBe(before);
    expect(published).toEqual([]);
    registry.install(defineExtension({ name: "tasks", tasks: [task("app.index", 2)] }));
    expect(registry.snapshot().task("app.index")?.definition.version).toBe(2);
  });

  it("always holds the built-in tasks, which are not an extension", () => {
    const registry = createRegistry();
    expect(registry.snapshot().installed()).toEqual([]);
    expect(registry.snapshot().tasks()).toEqual([GenerationTask, ToolTask, CompactionTask]);
    const custom = task("app.custom");
    registry.install(defineExtension({ name: "custom", tasks: [custom] }));
    expect(registry.snapshot().tasks()).toEqual([GenerationTask, ToolTask, CompactionTask, custom]);
    expect(registry.snapshot().task("app.custom")).toBe(custom);
    registry.uninstall(defineExtension({ name: "custom" }));
    expect(registry.snapshot().task("app.custom")).toBeUndefined();
  });
});

describe("settings", () => {
  it("keeps the default of a progress interval given as undefined", () => {
    expect(
      resolveSettings({ progress: { outputIntervalMs: 250, partialIntervalMs: undefined } })
        .progress,
    ).toEqual({
      outputIntervalMs: 250,
      partialIntervalMs: 100,
    });
  });
});

describe("agent resolution", () => {
  it("selects the default, an array, or the default edited by add and remove", () => {
    expect(names(resolve(undefined, snapshot).extensions)).toEqual([
      "coding",
      "skills",
      "reviewer",
    ]);
    const settings = { extensions: [Coding, Skills] };
    expect(names(resolve({}, snapshot, settings).extensions)).toEqual(["coding", "skills"]);
    expect(
      names(resolve({ extensions: ["reviewer", "coding"] }, snapshot, settings).extensions),
    ).toEqual(["reviewer", "coding"]);
    const edited = { extensions: { add: ["reviewer", "coding", "gone"], remove: ["skills"] } };
    expect(names(resolve(edited, snapshot, settings).extensions)).toEqual(["coding", "reviewer"]);
    const stale = { extensions: [defineExtension({ name: "skills" }), Skills] };
    expect(resolve({}, snapshot, stale).extensions).toEqual([Skills]);
  });

  it("skips uninstalled names and resolves them again once they are installed", () => {
    const local = createRegistry<harnessRegistrySupportTypes.AppTool>();
    local.install(Coding);
    const state: durableTypes.AgentState = { extensions: ["coding", "skills"] };
    expect(names(resolve(state, local.snapshot()).extensions)).toEqual(["coding"]);
    local.install(Skills);
    expect(names(resolve(state, local.snapshot()).extensions)).toEqual(["coding", "skills"]);
  });
});

describe("agent resolution", () => {
  it("replaces same-name tools in place, wraps the winner, then applies the filter", () => {
    const local = createRegistry<harnessRegistrySupportTypes.AppTool>();
    const venvBash = tool("bash", { description: "venv bash" });
    const calls: string[] = [];
    const Venv = defineExtension<harnessRegistrySupportTypes.AppTool>({
      name: "venv",
      tools: [venvBash],
    });
    const Timing = defineExtension<harnessRegistrySupportTypes.AppTool>({
      name: "timing",
      wraps: [
        wrapTool(bash, (inner) => ({ ...inner, description: `${inner.description} (timed)` })),
        wrapTool(bash, (inner) => ({ ...inner, description: `${inner.description} [2]` })),
        wrapTool(tool("grep"), () => {
          calls.push("grep");
          return tool("grep");
        }),
      ],
    });
    for (const extension of [Coding, Venv, Timing]) local.install(extension);
    const reports: unknown[] = [];
    const agent = resolve(undefined, local.snapshot(), {}, reports);
    expect(agent.tools.map((each) => [each.name, each.description])).toEqual([
      ["read", "read tool"],
      ["bash", "venv bash (timed) [2]"],
      ["edit", "edit tool"],
    ]);
    expect(reports).toEqual([]);
    expect(calls).toEqual([]);

    const filtered = resolve({ tools: ["edit", "missing", "read", "edit"] }, local.snapshot());
    expect(names(filtered.tools)).toEqual(["edit", "read"]);
    expect(names(resolve({ tools: { remove: ["bash"] } }, local.snapshot()).tools)).toEqual([
      "read",
      "edit",
    ]);
  });
});

describe("agent resolution", () => {
  it("drops a tool or section whose wrapper throws or renames it and reports the failure", () => {
    const local = createRegistry<harnessRegistrySupportTypes.AppTool>();
    const Broken = defineExtension<harnessRegistrySupportTypes.AppTool>({
      name: "broken",
      wraps: [
        wrapTool(read, () => {
          throw new Error("wrapper failed");
        }),
        wrapTool(edit, (inner) => ({ ...inner, name: "renamed" })),
        wrapSection("cwd", () => {
          throw new Error("section wrapper failed");
        }),
      ],
    });
    local.install(Coding);
    local.install(Broken);
    const reports: unknown[] = [];
    const agent = resolve(undefined, local.snapshot(), {}, reports);
    expect(names(agent.tools)).toEqual(["bash"]);
    expect(agent.sections.map((each) => each.key)).toEqual(["preamble"]);
    expect(reports.map((error) => (error as Error).message)).toEqual([
      "wrapper failed",
      "Wrapper renamed edit to renamed",
      "section wrapper failed",
    ]);
  });
});
