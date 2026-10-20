import { Effect } from "effect";
import { dual } from "effect/Function";

import type autocompleteTypesModule from "../src/autocomplete-types.ts";
import type editorTypes from "../src/components/editor.types.ts";
import type tuiInterfaceTypes from "../src/tui-interface.types.ts";
import TuiMainScreen from "../src/tui-main-screen.ts";
import type editorHelpersTypes from "./editor-helpers.types.ts";
import virtualTerminal from "./virtual-terminal.ts";

const { VirtualTerminal } = virtualTerminal;

function createTestTUI(cols = 80): tuiInterfaceTypes.TUI {
  return new TuiMainScreen(new VirtualTerminal(cols, 24));
}

const applyCompletion: {
  (
    lines: string[],
    cursorLine: number,
    cursorCol: number,
    item: { value: string },
    prefix: string,
  ): { lines: string[]; cursorLine: number; cursorCol: number };
  (
    cursorLine: number,
    cursorCol: number,
    item: { value: string },
    prefix: string,
  ): (lines: string[]) => { lines: string[]; cursorLine: number; cursorCol: number };
} = dual(
  5,
  (
    lines: string[],
    cursorLine: number,
    cursorCol: number,
    item: { value: string },
    prefix: string,
  ): { lines: string[]; cursorLine: number; cursorCol: number } => {
    const line = lines[cursorLine] || "";
    const before = line.slice(0, cursorCol - prefix.length);
    const after = line.slice(cursorCol);
    const newLines = [...lines];
    newLines[cursorLine] = before + item.value + after;
    return {
      cursorCol: cursorCol - prefix.length + item.value.length,
      cursorLine,
      lines: newLines,
    };
  },
);

const flushAutocomplete: Effect.Effect<void> = Effect.promise(() => Promise.resolve()).pipe(
  Effect.andThen(
    Effect.callback<void>((resume) => {
      setImmediate(() => resume(Effect.void));
    }),
  ),
);

const positionCursor: {
  (editor: editorTypes.Editor, line: number, col: number): void;
  (line: number, col: number): (editor: editorTypes.Editor) => void;
} = dual(3, (editor: editorTypes.Editor, line: number, col: number): void => {
  for (let i = 0; i < 20; i++) editor.handleInput("\x1b[A");
  for (let i = 0; i < line; i++) editor.handleInput("\x1b[B");
  editor.handleInput("\x01");
  for (let i = 0; i < col; i++) editor.handleInput("\x1b[C");
});

function pasteWithMarker(editor: editorTypes.Editor): string {
  const bigContent = "line\n".repeat(20).trimEnd();
  editor.handleInput(`\x1b[200~${bigContent}\x1b[201~`);
  return editor.getText();
}

function bigPaste(tag: string): string {
  return Array.from({ length: 12 }, (_, i) => `${tag}${i}`).join("\n");
}

const typeText: {
  (target: { handleInput(data: string): void }, text: string): void;
  (text: string): (target: { handleInput(data: string): void }) => void;
} = dual(2, (target: { handleInput(data: string): void }, text: string): void => {
  for (const char of text) target.handleInput(char);
});

function settlingProvider(
  provider: autocompleteTypesModule.AutocompleteProvider,
): editorHelpersTypes.SettlingProvider {
  let pending: Promise<autocompleteTypesModule.AutocompleteSuggestions | null> =
    Promise.resolve(null);
  const tracked: autocompleteTypesModule.AutocompleteProvider = {
    ...(provider.triggerCharacters === undefined
      ? {}
      : { triggerCharacters: provider.triggerCharacters }),
    applyCompletion: (lines, cursorLine, cursorCol, item, prefix) =>
      provider.applyCompletion(lines, cursorLine, cursorCol, item, prefix),
    getSuggestions: (lines, cursorLine, cursorCol, options) => {
      pending = provider.getSuggestions(lines, cursorLine, cursorCol, options);
      return pending;
    },
  };
  const settled = flushAutocomplete.pipe(
    Effect.andThen(Effect.promise(() => pending)),
    Effect.andThen(flushAutocomplete),
  );
  return { provider: tracked, settled };
}

const editorHelpers = {
  applyCompletion,
  bigPaste,
  createTestTUI,
  flushAutocomplete,
  pasteWithMarker,
  positionCursor,
  settlingProvider,
  typeText,
};

export default editorHelpers;
