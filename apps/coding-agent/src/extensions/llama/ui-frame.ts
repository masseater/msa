import tui from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";
import { dual } from "effect/Function";

import { DynamicBorder } from "../../modes/interactive/components/dynamic-border.ts";
import type { Theme } from "../../modes/interactive/theme/theme.ts";

const { Container, Spacer, Text } = tui;

export function selectTheme(theme: Theme) {
  return {
    description: (text: string) => theme.fg("muted", text),
    noMatch: (text: string) => theme.fg("warning", text),
    scrollInfo: (text: string) => theme.fg("dim", text),
    selectedPrefix: (text: string) => theme.fg("accent", text),
    selectedText: (text: string) => theme.fg("accent", text),
  };
}

function frameImpl(
  theme: Theme,
  title: string,
  body: tuiTypes.Component[],
  footer?: string,
): tuiTypes.Container {
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
  (theme: Theme, title: string, body: tuiTypes.Component[], footer?: string): tuiTypes.Container;
  (
    title: string,
    body: tuiTypes.Component[],
    footer?: string,
  ): (theme: Theme) => tuiTypes.Container;
} = dual((args: IArguments) => args.length >= 3, frameImpl);
