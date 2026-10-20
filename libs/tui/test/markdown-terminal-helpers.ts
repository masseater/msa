import assert from "node:assert";

import { Effect } from "effect";
import { dual } from "effect/Function";

import Markdown from "../src/components/markdown.ts";
import type tuiInterfaceTypes from "../src/tui-interface.types.ts";
import TuiMainScreen from "../src/tui-main-screen.ts";
import effectHelpers from "./effect-helpers.ts";
import type markdownTerminalHelpersTypes from "./markdown-terminal-helpers.types.ts";
import virtualTerminal from "./virtual-terminal.ts";
import type virtualTerminalTypes from "./virtual-terminal.types.ts";

const { VirtualTerminal } = virtualTerminal;

const { toJson } = effectHelpers;

type Verify = (terminal: virtualTerminalTypes.VirtualTerminal) => Effect.Effect<void>;

const renderMarkdownInTerminal: {
  (
    request: markdownTerminalHelpersTypes.MarkdownTerminalRequest,
    verify: Verify,
  ): Effect.Effect<void>;
  (
    verify: Verify,
  ): (request: markdownTerminalHelpersTypes.MarkdownTerminalRequest) => Effect.Effect<void>;
} = dual(
  2,
  (
    request: markdownTerminalHelpersTypes.MarkdownTerminalRequest,
    verify: Verify,
  ): Effect.Effect<void> =>
    Effect.suspend(() => {
      const terminal = new VirtualTerminal(request.width, request.height);
      const tui: tuiInterfaceTypes.TUI = new TuiMainScreen(terminal);
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

const findViewportRow: {
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
      return { line, row };
    }),
);

const markdownTerminalHelpers = {
  findViewportRow,
  renderMarkdownInTerminal,
};

export default markdownTerminalHelpers;
