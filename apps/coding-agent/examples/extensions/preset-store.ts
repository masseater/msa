import { NodeServices } from "@effect/platform-node";
import type aiTypes from "@msa/ai/index.types";
import codingAgent from "@msa/coding-agent";
import type codingAgentTypes from "@msa/coding-agent/index.types";
import { Console, Effect, FileSystem, ManagedRuntime, Option, Path, Schema } from "effect";

import type presetStoreTypes from "./preset-store.types.ts";

const { CONFIG_DIR_NAME, getAgentDir } = codingAgent;

const ThinkingLevelSchema = Schema.Literals([
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);

const PresetSchema = Schema.Struct({
  instructions: Schema.optional(Schema.String),
  model: Schema.optional(Schema.String),
  provider: Schema.optional(Schema.String),
  thinkingLevel: Schema.optional(ThinkingLevelSchema),
  tools: Schema.optional(Schema.Array(Schema.String)),
});

const PresetsSchema = Schema.Record(Schema.String, PresetSchema);

type Preset = typeof PresetSchema.Type;

type PresetsConfig = typeof PresetsSchema.Type;

type ThinkingLevel = typeof ThinkingLevelSchema.Type;

interface OriginalState {
  model: aiTypes.Model<aiTypes.Api> | undefined;
  thinkingLevel: ThinkingLevel;
  tools: string[];
}

const runtime = ManagedRuntime.make(NodeServices.layer);
const pathService = runtime.runSync(Path.Path);
const fsService = runtime.runSync(FileSystem.FileSystem);

const parsePresets = Schema.decodeUnknownOption(Schema.fromJsonString(PresetsSchema));

const readPresets = (file: string) =>
  Effect.gen(function* () {
    const content = yield* fsService.readFileString(file).pipe(Effect.option);
    if (Option.isNone(content)) return {};
    const parsed = parsePresets(content.value);
    if (Option.isNone(parsed)) {
      yield* Console.error(`Failed to load presets from ${file}`);
      return {};
    }
    return parsed.value;
  });

const loadPresets = (cwd: string) =>
  Effect.gen(function* () {
    const global = yield* readPresets(pathService.join(getAgentDir(), "presets.json"));
    const project = yield* readPresets(pathService.join(cwd, CONFIG_DIR_NAME, "presets.json"));
    const presets: PresetsConfig = { ...global, ...project };
    return presets;
  });

const describePreset = (preset: Preset): string => {
  const parts: string[] = [];

  if (
    preset.provider !== undefined &&
    preset.provider.length > 0 &&
    preset.model !== undefined &&
    preset.model.length > 0
  ) {
    parts.push(`${preset.provider}/${preset.model}`);
  }
  if (preset.thinkingLevel !== undefined) {
    parts.push(`thinking:${preset.thinkingLevel}`);
  }
  if (preset.tools !== undefined && preset.tools.length > 0) {
    parts.push(`tools:${preset.tools.join(",")}`);
  }
  if (preset.instructions !== undefined && preset.instructions.length > 0) {
    const truncated =
      preset.instructions.length > 30
        ? `${preset.instructions.slice(0, 27)}...`
        : preset.instructions;
    parts.push(`"${truncated}"`);
  }

  return parts.join(" | ");
};

const buildPresetDescription = describePreset;

const presetsPathHint = (cwd: string): string =>
  `${pathService.join(getAgentDir(), "presets.json")} or ${pathService.join(cwd, CONFIG_DIR_NAME, "presets.json")}`;

interface StoreState {
  presets: PresetsConfig;
  activeName: string | undefined;
  active: Preset | undefined;
  originalState: OriginalState | undefined;
}

const rememberOriginal = (
  msa: codingAgentTypes.ExtensionAPI,
  state: StoreState,
  ctx: codingAgentTypes.ExtensionContext,
): void => {
  if (state.activeName !== undefined) return;
  state.originalState = {
    model: ctx.model,
    thinkingLevel: msa.getThinkingLevel(),
    tools: msa.getActiveTools(),
  };
};

const applyModel = (
  msa: codingAgentTypes.ExtensionAPI,
  name: string,
  preset: Preset,
  ctx: codingAgentTypes.ExtensionContext,
) =>
  Effect.gen(function* () {
    if (
      preset.provider === undefined ||
      preset.provider.length === 0 ||
      preset.model === undefined ||
      preset.model.length === 0
    ) {
      return;
    }

    const model = ctx.modelRegistry.find(preset.provider, preset.model);
    if (model === undefined) {
      ctx.ui.notify(
        `Preset "${name}": Model ${preset.provider}/${preset.model} not found`,
        "warning",
      );
      return;
    }

    const success = yield* Effect.promise(() => msa.setModel(model));
    if (!success) {
      ctx.ui.notify(
        `Preset "${name}": No API key for ${preset.provider}/${preset.model}`,
        "warning",
      );
    }
  });

const applyTools = (
  msa: codingAgentTypes.ExtensionAPI,
  name: string,
  preset: Preset,
  ctx: codingAgentTypes.ExtensionContext,
): void => {
  if (preset.tools === undefined || preset.tools.length === 0) return;

  const allToolNames = msa.getAllTools().map((t) => t.name);
  const validTools = preset.tools.filter((t) => allToolNames.includes(t));
  const invalidTools = preset.tools.filter((t) => !allToolNames.includes(t));

  if (invalidTools.length > 0) {
    ctx.ui.notify(`Preset "${name}": Unknown tools: ${invalidTools.join(", ")}`, "warning");
  }
  if (validTools.length > 0) {
    msa.setActiveTools(validTools);
  }
};

const apply = (
  msa: codingAgentTypes.ExtensionAPI,
  state: StoreState,
  name: string,
  preset: Preset,
  ctx: codingAgentTypes.ExtensionContext,
) =>
  Effect.gen(function* () {
    rememberOriginal(msa, state, ctx);
    yield* applyModel(msa, name, preset, ctx);

    if (preset.thinkingLevel !== undefined) {
      msa.setThinkingLevel(preset.thinkingLevel);
    }
    applyTools(msa, name, preset, ctx);

    state.activeName = name;
    state.active = preset;
    return true;
  });

const clearPreset = (
  msa: codingAgentTypes.ExtensionAPI,
  state: StoreState,
  ctx: codingAgentTypes.ExtensionContext,
) =>
  Effect.gen(function* () {
    state.activeName = undefined;
    state.active = undefined;

    const original = state.originalState;
    if (original === undefined) {
      msa.setActiveTools(["read", "bash", "edit", "write"]);
    } else {
      if (original.model !== undefined) {
        const model = original.model;
        yield* Effect.promise(() => msa.setModel(model));
      }
      msa.setThinkingLevel(original.thinkingLevel);
      msa.setActiveTools(original.tools);
    }

    ctx.ui.notify("Preset cleared, defaults restored", "info");
  });

const createPresetStore = (msa: codingAgentTypes.ExtensionAPI): presetStoreTypes.PresetStore => {
  const state: StoreState = {
    active: undefined,
    activeName: undefined,
    originalState: undefined,
    presets: {},
  };

  return {
    get active() {
      return state.active;
    },
    get activeName() {
      return state.activeName;
    },
    apply: (name, preset, ctx) => runtime.runPromise(apply(msa, state, name, preset, ctx)),
    clear: (ctx) => runtime.runPromise(clearPreset(msa, state, ctx)),
    load: (cwd) =>
      runtime.runPromise(
        Effect.map(loadPresets(cwd), (presets) => {
          state.presets = presets;
        }),
      ),
    order: () => Object.keys(state.presets).sort(),
    get presets() {
      return state.presets;
    },
    restoreActive: (name) => {
      state.activeName = name;
      state.active = state.presets[name];
    },
    updateStatus: (ctx) => {
      const label =
        state.activeName !== undefined && state.activeName.length > 0
          ? state.activeName
          : undefined;
      ctx.ui.setStatus(
        "preset",
        label === undefined ? undefined : ctx.ui.theme.fg("accent", `preset:${label}`),
      );
    },
  };
};

const presetStore = {
  PresetSchema,
  PresetsSchema,
  ThinkingLevelSchema,
  buildPresetDescription,
  createPresetStore,
  presetsPathHint,
};

export default presetStore;
