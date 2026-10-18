import type { ExtensionContext } from "@msa/coding-agent";
import { DynamicBorder } from "@msa/coding-agent";
import { Container, type SelectItem, SelectList, Text } from "@msa/tui";
import { Effect } from "effect";

import { buildPresetDescription, type PresetStore, presetsPathHint } from "./preset-store.ts";

const buildItems = (store: PresetStore): SelectItem[] => {
  const items: SelectItem[] = Object.entries(store.presets).map(([name, preset]) => ({
    value: name,
    label: name === store.activeName ? `${name} (active)` : name,
    description: buildPresetDescription(preset),
  }));

  items.push({
    value: "(none)",
    label: "(none)",
    description: "Clear active preset, restore defaults",
  });
  return items;
};

const openSelector = (ctx: ExtensionContext, items: SelectItem[]): Promise<string | null> =>
  ctx.ui.custom<string | null>((tui, theme, _kb, done) => {
    const container = new Container();
    container.addChild(new DynamicBorder((str) => theme.fg("accent", str)));
    container.addChild(new Text(theme.fg("accent", theme.bold("Select Preset"))));

    const selectList = new SelectList(items, Math.min(items.length, 10), {
      selectedPrefix: (text) => theme.fg("accent", text),
      selectedText: (text) => theme.fg("accent", text),
      description: (text) => theme.fg("muted", text),
      scrollInfo: (text) => theme.fg("dim", text),
      noMatch: (text) => theme.fg("warning", text),
    });

    selectList.onSelect = (item) => done(item.value);
    selectList.onCancel = () => done(null);

    container.addChild(selectList);
    container.addChild(new Text(theme.fg("dim", "↑↓ navigate • enter select • esc cancel")));
    container.addChild(new DynamicBorder((str) => theme.fg("accent", str)));

    return {
      render: (width: number) => container.render(width),
      invalidate: () => container.invalidate(),
      handleInput: (data: string) => {
        selectList.handleInput(data);
        tui.requestRender();
      },
    };
  });

export const showPresetSelector = (request: {
  readonly store: PresetStore;
  readonly ctx: ExtensionContext;
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
