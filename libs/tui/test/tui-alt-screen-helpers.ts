import { Effect } from "effect";
import { dual } from "effect/Function";

import { type Component, type TerminalCapabilities, TuiAltScreen, VStack } from "../src/index.ts";
import { resetCapabilitiesCache, setCapabilities } from "../src/terminal-capabilities.ts";
import type tuiAltScreenHelpersTypes from "./tui-alt-screen-helpers.types.ts";
import { VirtualTerminal } from "./virtual-terminal.ts";

const OSC133_ZONE_START = "\x1b]133;A\x07";

const scrollLineByLine: {
  (tui: TuiAltScreen, terminal: VirtualTerminal, steps: number): Effect.Effect<void>;
  (terminal: VirtualTerminal, steps: number): (tui: TuiAltScreen) => Effect.Effect<void>;
} = dual(3, (tui: TuiAltScreen, terminal: VirtualTerminal, steps: number): Effect.Effect<void> =>
  Effect.gen(function* () {
    for (let step = 0; step < steps; step++) {
      tui.scrollBy(1);
      yield* Effect.promise(() => terminal.waitForRender());
    }
  }),
);

const writesSince: {
  (terminal: tuiAltScreenHelpersTypes.RecordedEvents, eventCount: number): string;
  (eventCount: number): (terminal: tuiAltScreenHelpersTypes.RecordedEvents) => string;
} = dual(2, (terminal: tuiAltScreenHelpersTypes.RecordedEvents, eventCount: number): string =>
  terminal.events
    .slice(eventCount)
    .filter((event): event is { type: "write"; data: string } => event.type === "write")
    .map((event) => event.data)
    .join(""),
);

const withCapabilities: {
  (capabilities: TerminalCapabilities, effect: Effect.Effect<void>): Effect.Effect<void>;
  (effect: Effect.Effect<void>): (capabilities: TerminalCapabilities) => Effect.Effect<void>;
} = dual(
  2,
  (capabilities: TerminalCapabilities, effect: Effect.Effect<void>): Effect.Effect<void> =>
    Effect.suspend(() => {
      setCapabilities(capabilities);
      return effect.pipe(
        Effect.ensuring(
          Effect.sync(() => {
            resetCapabilitiesCache();
          }),
        ),
      );
    }),
);

const viewportHas: {
  (terminal: VirtualTerminal, text: string): boolean;
  (text: string): (terminal: VirtualTerminal) => boolean;
} = dual(2, (terminal: VirtualTerminal, text: string): boolean =>
  terminal.getViewport().some((line) => line.includes(text)),
);

const someWriteSince: {
  (terminal: tuiAltScreenHelpersTypes.RecordedEvents, eventCount: number, text: string): boolean;
  (
    eventCount: number,
    text: string,
  ): (terminal: tuiAltScreenHelpersTypes.RecordedEvents) => boolean;
} = dual(
  3,
  (terminal: tuiAltScreenHelpersTypes.RecordedEvents, eventCount: number, text: string): boolean =>
    terminal.events
      .slice(eventCount)
      .some((event) => event.type === "write" && event.data.includes(text)),
);

const mountTranscriptWithEditor: {
  (tui: TuiAltScreen, transcript: Component): string[];
  (transcript: Component): (tui: TuiAltScreen) => string[];
} = dual(2, (tui: TuiAltScreen, transcript: Component): string[] => {
  const editorInputs: string[] = [];
  const editor = {
    focused: false,
    handleInput: (data: string) => editorInputs.push(data),
    invalidate: () => {},
    render: () => ["editor"],
  };
  tui.setLayoutRoot(
    new VStack([
      { basis: 0, component: transcript, grow: 1, minSize: 1 },
      { basis: 1, component: editor, shrink: 0 },
    ]),
  );
  tui.setFocus(editor);
  return editorInputs;
});

const trimmedViewport = (terminal: VirtualTerminal): string[] =>
  terminal.getViewport().map((line) => line.trimEnd());

const numberedLines: {
  (from: number, to: number): string[];
  (to: number): (from: number) => string[];
} = dual(2, (from: number, to: number): string[] =>
  Array.from({ length: to - from + 1 }, (_, index) => `line ${from + index}`),
);

const tuiAltScreenHelpers = {
  OSC133_ZONE_START,
  mountTranscriptWithEditor,
  numberedLines,
  scrollLineByLine,
  someWriteSince,
  trimmedViewport,
  viewportHas,
  withCapabilities,
  writesSince,
};

export default tuiAltScreenHelpers;
