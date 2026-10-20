import ai from "@msa/ai";
import type { ExtensionAPI, ExtensionContext, Theme } from "@msa/coding-agent";
import tui from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";
import { Effect } from "effect";
import { Type } from "typebox";

import { type Todo, TodoListComponent } from "./todo-list.ts";

const { StringEnum } = ai;

const { Text } = tui;

interface TodoDetails {
  action: "list" | "add" | "toggle" | "clear";
  todos: Todo[];
  nextId: number;
  error?: string;
}

const TodoParams = Type.Object({
  action: StringEnum(["list", "add", "toggle", "clear"] as const),
  id: Type.Optional(Type.Number({ description: "Todo ID (for toggle)" })),
  text: Type.Optional(Type.String({ description: "Todo text (for add)" })),
});

interface TodoState {
  todos: Todo[];
  nextId: number;
}

const details = (state: TodoState, action: TodoDetails["action"], error?: string): TodoDetails => ({
  action,
  nextId: state.nextId,
  todos: [...state.todos],
  ...(error === undefined ? {} : { error }),
});

const textContent = (value: string) => ({ text: value, type: "text" as const });

const listAction = (state: TodoState) => ({
  content: [
    textContent(
      state.todos.length === 0
        ? "No todos"
        : state.todos.map((t) => `[${t.done ? "x" : " "}] #${t.id}: ${t.text}`).join("\n"),
    ),
  ],
  details: details(state, "list"),
});

const addAction = (state: TodoState, value: string | undefined) => {
  if (value === undefined || value.length === 0) {
    return {
      content: [textContent("Error: text required for add")],
      details: details(state, "add", "text required"),
    };
  }
  const newTodo: Todo = { done: false, id: state.nextId++, text: value };
  state.todos.push(newTodo);
  return {
    content: [textContent(`Added todo #${newTodo.id}: ${newTodo.text}`)],
    details: details(state, "add"),
  };
};

const toggleAction = (state: TodoState, id: number | undefined) => {
  if (id === undefined) {
    return {
      content: [textContent("Error: id required for toggle")],
      details: details(state, "toggle", "id required"),
    };
  }
  const todo = state.todos.find((t) => t.id === id);
  if (todo === undefined) {
    return {
      content: [textContent(`Todo #${id} not found`)],
      details: details(state, "toggle", `#${id} not found`),
    };
  }
  todo.done = !todo.done;
  return {
    content: [textContent(`Todo #${todo.id} ${todo.done ? "completed" : "uncompleted"}`)],
    details: details(state, "toggle"),
  };
};

const clearAction = (state: TodoState) => {
  const count = state.todos.length;
  state.todos = [];
  state.nextId = 1;
  return {
    content: [textContent(`Cleared ${count} todos`)],
    details: { action: "clear", nextId: 1, todos: [] } as TodoDetails,
  };
};

const runAction = (state: TodoState, params: { action: string; text?: string; id?: number }) => {
  switch (params.action) {
    case "list":
      return listAction(state);
    case "add":
      return addAction(state, params.text);
    case "toggle":
      return toggleAction(state, params.id);
    case "clear":
      return clearAction(state);
    default:
      return {
        content: [textContent(`Unknown action: ${params.action}`)],
        details: details(state, "list", `unknown action: ${params.action}`),
      };
  }
};

const reconstructState = (state: TodoState, ctx: ExtensionContext): void => {
  state.todos = [];
  state.nextId = 1;

  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.type !== "message") continue;
    const msg = entry.message;
    if (msg.role !== "toolResult" || msg.toolName !== "todo") continue;

    const data = msg.details as TodoDetails | undefined;
    if (data !== undefined) {
      state.todos = data.todos;
      state.nextId = data.nextId;
    }
  }
};

const renderCall = (
  args: { action: string; text?: string; id?: number },
  theme: Theme,
): tuiTypes.Text => {
  let text = theme.fg("toolTitle", theme.bold("todo ")) + theme.fg("muted", args.action);
  if (args.text !== undefined && args.text.length > 0) {
    text += ` ${theme.fg("dim", `"${args.text}"`)}`;
  }
  if (args.id !== undefined) text += ` ${theme.fg("accent", `#${args.id}`)}`;
  return new Text(text, 0, 0);
};

const renderTodoList = (todos: Todo[], expanded: boolean, theme: Theme): tuiTypes.Text => {
  if (todos.length === 0) {
    return new Text(theme.fg("dim", "No todos"), 0, 0);
  }
  let listText = theme.fg("muted", `${todos.length} todo(s):`);
  const display = expanded ? todos : todos.slice(0, 5);
  for (const t of display) {
    const check = t.done ? theme.fg("success", "✓") : theme.fg("dim", "○");
    const itemText = t.done ? theme.fg("dim", t.text) : theme.fg("muted", t.text);
    listText += `\n${check} ${theme.fg("accent", `#${t.id}`)} ${itemText}`;
  }
  if (!expanded && todos.length > 5) {
    listText += `\n${theme.fg("dim", `... ${todos.length - 5} more`)}`;
  }
  return new Text(listText, 0, 0);
};

const renderAdded = (todos: Todo[], theme: Theme): tuiTypes.Text => {
  const added = todos.at(-1);
  if (added === undefined) return new Text(theme.fg("success", "✓ Added"), 0, 0);
  return new Text(
    theme.fg("success", "✓ Added ") +
      theme.fg("accent", `#${added.id}`) +
      " " +
      theme.fg("muted", added.text),
    0,
    0,
  );
};

const renderResult = (
  result: { content: ReadonlyArray<{ type: string; text?: string }>; details: unknown },
  options: { expanded: boolean },
  theme: Theme,
): tuiTypes.Text => {
  const data = result.details as TodoDetails | undefined;
  if (data === undefined) {
    const content = result.content[0];
    return new Text(content?.type === "text" ? (content.text ?? "") : "", 0, 0);
  }

  if (data.error !== undefined && data.error.length > 0) {
    return new Text(theme.fg("error", `Error: ${data.error}`), 0, 0);
  }

  switch (data.action) {
    case "list":
      return renderTodoList(data.todos, options.expanded, theme);
    case "add":
      return renderAdded(data.todos, theme);
    case "toggle": {
      const content = result.content[0];
      return new Text(theme.fg("success", "✓ ") + theme.fg("muted", content?.text ?? ""), 0, 0);
    }
    case "clear":
      return new Text(theme.fg("success", "✓ ") + theme.fg("muted", "Cleared all todos"), 0, 0);
  }
};

const showTodoList = (state: TodoState, ctx: ExtensionContext) =>
  Effect.gen(function* () {
    if (ctx.mode !== "tui") {
      ctx.ui.notify("/todos requires interactive mode", "error");
      return;
    }
    yield* Effect.promise(() =>
      ctx.ui.custom<void>(
        (_tui, theme, _kb, done) => new TodoListComponent(state.todos, theme, () => done()),
      ),
    );
  });

export default function (msa: ExtensionAPI) {
  const state: TodoState = { nextId: 1, todos: [] };

  msa.on("session_start", (_event, ctx) => reconstructState(state, ctx));
  msa.on("session_tree", (_event, ctx) => reconstructState(state, ctx));

  msa.registerTool({
    description: "Manage a todo list. Actions: list, add (text), toggle (id), clear",
    execute: (_toolCallId, params, _signal, _onUpdate, _ctx) =>
      Effect.runPromise(Effect.sync(() => runAction(state, params))),
    label: "Todo",
    name: "todo",
    parameters: TodoParams,
    renderCall,
    renderResult,
  });

  msa.registerCommand("todos", {
    description: "Show all todos on the current branch",
    handler: (_args, ctx) => Effect.runPromise(showTodoList(state, ctx)),
  });
}
