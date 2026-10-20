import type codingAgentTypes from "@msa/coding-agent/index.types";

import type presetStore from "./preset-store.ts";

declare namespace presetStoreTypes {
  type Preset = typeof presetStore.PresetSchema.Type;

  type PresetsConfig = typeof presetStore.PresetsSchema.Type;

  type ThinkingLevel = typeof presetStore.ThinkingLevelSchema.Type;

  interface PresetStore {
    presets: PresetsConfig;
    activeName: string | undefined;
    active: Preset | undefined;
    load(cwd: string): Promise<void>;
    apply(name: string, preset: Preset, ctx: codingAgentTypes.ExtensionContext): Promise<boolean>;
    clear(ctx: codingAgentTypes.ExtensionContext): Promise<void>;
    restoreActive(name: string): void;
    updateStatus(ctx: codingAgentTypes.ExtensionContext): void;
    order(): string[];
  }
}

export type { presetStoreTypes as default };
