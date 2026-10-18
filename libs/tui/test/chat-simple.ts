import chalk from "chalk";
import { Effect, Random } from "effect";

import { runAfter } from "../src/delay.ts";
import {
  CombinedAutocompleteProvider,
  Editor,
  Loader,
  Markdown,
  ProcessTerminal,
  Text,
  type TUI,
  TuiMainScreen,
} from "../src/index.ts";
import { defaultEditorTheme, defaultMarkdownTheme } from "./test-themes.ts";

const terminal = new ProcessTerminal();

const tui: TUI = new TuiMainScreen(terminal);

tui.addChild(
  new Text(
    "Welcome to Simple Chat!\n\nType your messages below. Type '/' for commands. Press Ctrl+C to exit.",
  ),
);

const editor = new Editor(tui, defaultEditorTheme);

const autocompleteProvider = new CombinedAutocompleteProvider(
  [
    { name: "delete", description: "Delete the last message" },
    { name: "clear", description: "Clear all messages" },
  ],
  process.cwd(),
);
editor.setAutocompleteProvider(autocompleteProvider);

tui.addChild(editor);

tui.setFocus(editor);

let isResponding = false;

const responses = [
  "That's interesting! Tell me more.",
  "I see what you mean.",
  "Fascinating perspective!",
  "Could you elaborate on that?",
  "That makes sense to me.",
  "I hadn't thought of it that way.",
  "Great point!",
  "Thanks for sharing that.",
];

function runCommand(trimmed: string): boolean {
  const children = tui.children;
  if (trimmed === "/delete") {
    if (children.length > 3) {
      children.splice(children.length - 2, 1);
    }
    tui.requestRender();
    return true;
  }
  if (trimmed === "/clear") {
    children.splice(2, children.length - 3);
    tui.requestRender();
    return true;
  }
  return false;
}

function respond(loader: Loader): void {
  const children = tui.children;
  tui.removeChild(loader);
  const randomResponse = responses[Math.floor(Effect.runSync(Random.next) * responses.length)];
  if (randomResponse === undefined) throw new Error("No response was picked");

  const botMessage = new Markdown(randomResponse, 1, 1, defaultMarkdownTheme);
  children.splice(children.length - 1, 0, botMessage);

  isResponding = false;
  editor.disableSubmit = false;

  tui.requestRender();
}

function submitMessage(value: string): void {
  isResponding = true;
  editor.disableSubmit = true;

  const userMessage = new Markdown(value, 1, 1, defaultMarkdownTheme);

  const children = tui.children;
  children.splice(children.length - 1, 0, userMessage);

  const loader = new Loader(
    tui,
    (s) => chalk.cyan(s),
    (s) => chalk.dim(s),
    "Thinking...",
  );
  children.splice(children.length - 1, 0, loader);

  tui.requestRender();

  runAfter(1000, () => respond(loader));
}

editor.onSubmit = (value: string) => {
  if (isResponding) {
    return;
  }
  const trimmed = value.trim();
  if (runCommand(trimmed)) {
    return;
  }
  if (trimmed !== "") {
    submitMessage(value);
  }
};

tui.start();
