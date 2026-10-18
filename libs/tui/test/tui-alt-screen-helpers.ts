import { Effect } from "effect";
import { dual } from "effect/Function";

import { type Component, type TerminalCapabilities, TuiAltScreen, VStack } from "../src/index.ts";
import { resetCapabilitiesCache, setCapabilities } from "../src/terminal-capabilities.ts";
import { VirtualTerminal } from "./virtual-terminal.ts";

export const OSC133_ZONE_START = "\x1b]133;A\x07";

export const scrollLineByLine: {
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

export interface RecordedEvents {
  readonly events: ReadonlyArray<
    { type: "write"; data: string } | { type: "start" } | { type: "stop" }
  >;
}

export const writesSince: {
  (terminal: RecordedEvents, eventCount: number): string;
  (eventCount: number): (terminal: RecordedEvents) => string;
} = dual(2, (terminal: RecordedEvents, eventCount: number): string =>
  terminal.events
    .slice(eventCount)
    .filter((event): event is { type: "write"; data: string } => event.type === "write")
    .map((event) => event.data)
    .join(""),
);

export const withCapabilities: {
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

export const viewportHas: {
  (terminal: VirtualTerminal, text: string): boolean;
  (text: string): (terminal: VirtualTerminal) => boolean;
} = dual(2, (terminal: VirtualTerminal, text: string): boolean =>
  terminal.getViewport().some((line) => line.includes(text)),
);

export const someWriteSince: {
  (terminal: RecordedEvents, eventCount: number, text: string): boolean;
  (eventCount: number, text: string): (terminal: RecordedEvents) => boolean;
} = dual(3, (terminal: RecordedEvents, eventCount: number, text: string): boolean =>
  terminal.events
    .slice(eventCount)
    .some((event) => event.type === "write" && event.data.includes(text)),
);

export const mountTranscriptWithEditor: {
  (tui: TuiAltScreen, transcript: Component): string[];
  (transcript: Component): (tui: TuiAltScreen) => string[];
} = dual(2, (tui: TuiAltScreen, transcript: Component): string[] => {
  const editorInputs: string[] = [];
  const editor = {
    focused: false,
    render: () => ["editor"],
    invalidate: () => {},
    handleInput: (data: string) => editorInputs.push(data),
  };
  tui.setLayoutRoot(
    new VStack([
      { component: transcript, basis: 0, grow: 1, minSize: 1 },
      { component: editor, basis: 1, shrink: 0 },
    ]),
  );
  tui.setFocus(editor);
  return editorInputs;
});

export const trimmedViewport = (terminal: VirtualTerminal): string[] =>
  terminal.getViewport().map((line) => line.trimEnd());

export const numberedLines: {
  (from: number, to: number): string[];
  (to: number): (from: number) => string[];
} = dual(2, (from: number, to: number): string[] =>
  Array.from({ length: to - from + 1 }, (_, index) => `line ${from + index}`),
);
