import assert from "node:assert";

import { Effect } from "effect";
import { dual } from "effect/Function";

import { Markdown, type MarkdownTheme } from "../src/components/markdown.ts";
import { TuiMainScreen } from "../src/tui-main-screen.ts";
import type { TUI } from "../src/tui.ts";
import { toJson } from "./effect-helpers.ts";
import { VirtualTerminal } from "./virtual-terminal.ts";

export interface MarkdownTerminalRequest {
  readonly source: string;
  readonly theme: MarkdownTheme;
  readonly width: number;
  readonly height: number;
}

type Verify = (terminal: VirtualTerminal) => Effect.Effect<void>;

export const renderMarkdownInTerminal: {
  (request: MarkdownTerminalRequest, verify: Verify): Effect.Effect<void>;
  (verify: Verify): (request: MarkdownTerminalRequest) => Effect.Effect<void>;
} = dual(2, (request: MarkdownTerminalRequest, verify: Verify): Effect.Effect<void> =>
  Effect.suspend(() => {
    const terminal = new VirtualTerminal(request.width, request.height);
    const tui: TUI = new TuiMainScreen(terminal);
    tui.addChild(new Markdown(request.source, 0, 0, request.theme));
    tui.start();
    return Effect.gen(function* () {
      yield* Effect.promise(() => terminal.waitForRender());
      yield* verify(terminal);
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          tui.stop();
        }),
      ),
    );
  }),
);

type ViewportRow = { row: number; line: string };

export const findViewportRow: {
  (
    viewport: string[],
    predicate: (line: string) => boolean,
    message: string,
  ): Effect.Effect<ViewportRow>;
  (
    predicate: (line: string) => boolean,
    message: string,
  ): (viewport: string[]) => Effect.Effect<ViewportRow>;
} = dual(
  3,
  (
    viewport: string[],
    predicate: (line: string) => boolean,
    message: string,
  ): Effect.Effect<ViewportRow> =>
    Effect.gen(function* () {
      const row = viewport.findIndex(predicate);
      assert.notStrictEqual(row, -1, `${message}: ${yield* Effect.orDie(toJson(viewport))}`);
      const line = viewport[row];
      assert.ok(line !== undefined);
      return { row, line };
    }),
);
