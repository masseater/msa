import codingAgent from "@msa/coding-agent";
import type codingAgentTypes from "@msa/coding-agent/index.types";
import tuiModule from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";
import { Effect } from "effect";

import presetStore from "./preset-store.ts";
import type presetStoreTypes from "./preset-store.types.ts";

const { buildPresetDescription, presetsPathHint } = presetStore;
const { DynamicBorder } = codingAgent;

const { Container, SelectList, Text } = tuiModule;

const buildItems = (store: presetStoreTypes.PresetStore): tuiTypes.SelectItem[] => {
  const items: tuiTypes.SelectItem[] = Object.entries(store.presets).map(([name, preset]) => ({
    description: buildPresetDescription(preset),
    label: name === store.activeName ? `${name} (active)` : name,
    value: name,
  }));

  items.push({
    description: "Clear active preset, restore defaults",
    label: "(none)",
    value: "(none)",
  });
  return items;
};

const openSelector = (
  ctx: codingAgentTypes.ExtensionContext,
  items: tuiTypes.SelectItem[],
): Promise<string | null> =>
  ctx.ui.custom<string | null>((tui, theme, _kb, done) => {
    const container = new Container();
    container.addChild(new DynamicBorder((str) => theme.fg("accent", str)));
    container.addChild(new Text(theme.fg("accent", theme.bold("Select Preset"))));

    const selectList = new SelectList(items, Math.min(items.length, 10), {
      description: (text) => theme.fg("muted", text),
      noMatch: (text) => theme.fg("warning", text),
      scrollInfo: (text) => theme.fg("dim", text),
      selectedPrefix: (text) => theme.fg("accent", text),
      selectedText: (text) => theme.fg("accent", text),
    });

    selectList.onSelect = (item) => done(item.value);
    selectList.onCancel = () => done(null);

    container.addChild(selectList);
    container.addChild(new Text(theme.fg("dim", "↑↓ navigate • enter select • esc cancel")));
    container.addChild(new DynamicBorder((str) => theme.fg("accent", str)));

    return {
      handleInput: (data: string) => {
        selectList.handleInput(data);
        tui.requestRender();
      },
      invalidate: () => container.invalidate(),
      render: (width: number) => container.render(width),
    };
  });

const showPresetSelector = (request: {
  readonly store: presetStoreTypes.PresetStore;
  readonly ctx: codingAgentTypes.ExtensionContext;
}) =>
  Effect.gen(function* () {
    const { store, ctx } = request;
    if (Object.keys(store.presets).length === 0) {
      ctx.ui.notify(`No presets defined. Add presets to ${presetsPathHint(ctx.cwd)}`, "warning");
      return;
    }

    const result = yield* Effect.promise(() => openSelector(ctx, buildItems(store)));
    if (result === null || result.length === 0) return;

    if (result === "(none)") {
      yield* Effect.promise(() => store.clear(ctx));
      store.updateStatus(ctx);
      return;
    }

    const preset = store.presets[result];
    if (preset === undefined) return;

    yield* Effect.promise(() => store.apply(result, preset, ctx));
    ctx.ui.notify(`Preset "${result}" activated`, "info");
    store.updateStatus(ctx);
  });

const presetUi = {
  showPresetSelector,
};

export default presetUi;
