import { type Component, Container, Spacer, Text } from "@msa/tui";
import { dual } from "effect/Function";

import { DynamicBorder } from "../../modes/interactive/components/dynamic-border.ts";
import type { Theme } from "../../modes/interactive/theme/theme.ts";

export function selectTheme(theme: Theme) {
  return {
    selectedPrefix: (text: string) => theme.fg("accent", text),
    selectedText: (text: string) => theme.fg("accent", text),
    description: (text: string) => theme.fg("muted", text),
    scrollInfo: (text: string) => theme.fg("dim", text),
    noMatch: (text: string) => theme.fg("warning", text),
  };
}

function frameImpl(theme: Theme, title: string, body: Component[], footer?: string): Container {
  const container = new Container();
  container.addChild(new DynamicBorder((text: string) => theme.fg("accent", text)));
  container.addChild(new Text(theme.fg("accent", theme.bold(title)), 1, 0));
  for (const child of body) container.addChild(child);
  if (footer !== undefined && footer !== "") {
    container.addChild(new Spacer(1));
    container.addChild(new Text(theme.fg("dim", footer), 1, 0));
  }
  container.addChild(new DynamicBorder((text: string) => theme.fg("accent", text)));
  return container;
}

export const frame: {
  (theme: Theme, title: string, body: Component[], footer?: string): Container;
  (title: string, body: Component[], footer?: string): (theme: Theme) => Container;
} = dual((args: IArguments) => args.length >= 3, frameImpl);
