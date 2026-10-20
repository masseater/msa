import type { ExtensionAPI, ExtensionContext } from "@msa/coding-agent";
import tui from "@msa/tui";
import { Effect } from "effect";

import { type Preset, type PresetStore, createPresetStore } from "./preset-store.ts";
import { showPresetSelector } from "./preset-ui.ts";

const { Key } = tui;

const activate = (store: PresetStore, name: string, preset: Preset, ctx: ExtensionContext) =>
  Effect.gen(function* () {
    yield* Effect.promise(() => store.apply(name, preset, ctx));
    ctx.ui.notify(`Preset "${name}" activated`, "info");
    store.updateStatus(ctx);
  });

const cyclePreset = (store: PresetStore, ctx: ExtensionContext) =>
  Effect.gen(function* () {
    const names = store.order();
    if (names.length === 0) {
      ctx.ui.notify("No presets defined. Add a presets.json to the agent directory.", "warning");
      return;
    }

    const cycleList = ["(none)", ...names];
    const currentIndex = cycleList.indexOf(store.activeName ?? "(none)");
    const nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % cycleList.length;
    const nextName = cycleList[nextIndex];
    if (nextName === undefined) return;

    if (nextName === "(none)") {
      yield* Effect.promise(() => store.clear(ctx));
      store.updateStatus(ctx);
      return;
    }

    const preset = store.presets[nextName];
    if (preset === undefined) return;
    yield* activate(store, nextName, preset, ctx);
  });

const runPresetCommand = (store: PresetStore, args: string, ctx: ExtensionContext) =>
  Effect.gen(function* () {
    const name = args.trim();
    if (name.length === 0) {
      yield* showPresetSelector({ ctx, store });
      return;
    }

    const preset = store.presets[name];
    if (preset === undefined) {
      const available = Object.keys(store.presets).join(", ") || "(none defined)";
      ctx.ui.notify(`Unknown preset "${name}". Available: ${available}`, "error");
      return;
    }

    yield* activate(store, name, preset, ctx);
  });

const restoreFromBranch = (msa: ExtensionAPI, store: PresetStore, ctx: ExtensionContext): void => {
  const presetFlag = msa.getFlag("preset");
  if (typeof presetFlag === "string" && presetFlag.length > 0) {
    const preset = store.presets[presetFlag];
    if (preset === undefined) {
      const available = Object.keys(store.presets).join(", ") || "(none defined)";
      ctx.ui.notify(`Unknown preset "${presetFlag}". Available: ${available}`, "warning");
    } else {
      void store.apply(presetFlag, preset, ctx);
    }
  }

  const entries = ctx.sessionManager.getEntries();
  const presetEntry = entries
    .filter(
      (e: { type: string; customType?: string }) =>
        e.type === "custom" && e.customType === "preset-state",
    )
    .pop() as { data?: { name: string } } | undefined;

  const entryName = presetEntry?.data?.name;
  const hasFlag = typeof presetFlag === "string" && presetFlag.length > 0;
  if (entryName !== undefined && entryName.length > 0 && !hasFlag) {
    store.restoreActive(entryName);
  }

  store.updateStatus(ctx);
};

export default function presetExtension(msa: ExtensionAPI) {
  const store = createPresetStore(msa);

  msa.registerFlag("preset", {
    description: "Preset configuration to use",
    type: "string",
  });

  msa.registerShortcut(Key.ctrlShift("u"), {
    description: "Cycle presets",
    handler: (ctx) => Effect.runPromise(cyclePreset(store, ctx)),
  });

  msa.registerCommand("preset", {
    description: "Switch preset configuration",
    handler: (args, ctx) => Effect.runPromise(runPresetCommand(store, args, ctx)),
  });

  msa.on("before_agent_start", (event) => {
    const instructions = store.active?.instructions;
    if (instructions !== undefined && instructions.length > 0) {
      return { systemPrompt: `${event.systemPrompt}\n\n${instructions}` };
    }
    return undefined;
  });

  msa.on("session_start", (_event, ctx) => {
    store.load(ctx.cwd);
    restoreFromBranch(msa, store, ctx);
  });

  msa.on("turn_start", () => {
    const name = store.activeName;
    if (name !== undefined && name.length > 0) {
      msa.appendEntry("preset-state", { name });
    }
  });
}
