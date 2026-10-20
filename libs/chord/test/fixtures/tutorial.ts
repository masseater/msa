import { type Static, Type } from "typebox";

import {
  type Factory,
  type Host,
  type StateOptions,
  forbidden,
  hostNamed,
  invalid,
  local,
  method,
  opaque,
  remote,
} from "../../src/index.ts";
import type tutorialTypes from "./tutorial.types.ts";

const TodoLabel = local("tutorial.todos", {
  input: Type.Object({ list: Type.String() }),
  members: { label: method(undefined, Type.String()) },
  version: 1,
});

const Todo = Type.Object({ done: Type.Boolean(), text: Type.String() });
const Rows = Type.Array(Todo);
const TodoStore = local("tutorial.todos", {
  input: Type.Object({ list: Type.String() }),
  members: {
    add: method(Type.Object({ text: Type.String() })),
    finish: method(Type.Object({ index: Type.Integer() })),
    label: method(undefined, Type.String()),
    openCount: Type.Number(),
    reset: method(Rows),
    rows: Rows,
  },
  version: 1,
});

const todoStore =
  (options?: StateOptions<Static<typeof Rows>>): Factory<typeof TodoStore> =>
  ({ list }, _principal, self) => {
    const rows = self.state("rows", Rows, [], options);
    const openCount = self.derive([rows], (todos) => todos.filter((todo) => !todo.done).length);
    return {
      add: ({ text }, ctx) => {
        rows.change(ctx, (draft) => {
          draft.push({ done: false, text });
        });
      },
      finish: ({ index }, ctx) => {
        rows.change(ctx, (draft) => {
          const todo = draft[index];
          if (todo === undefined) throw invalid("args", "No such todo");
          todo.done = true;
        });
      },
      label: () => `Todos for ${list}`,
      openCount,
      reset: (next, ctx) => {
        rows.replace(ctx, next, { diff: true });
      },
      rows,
    };
  };

const Database = local("tutorial.database", {
  input: Type.Object({}),
  members: { db: opaque<{ saved: string[] }>("tutorial.database@1") },
  version: 1,
});
const SavedTodos = local("tutorial.saved-todos", {
  input: Type.Object({ list: Type.String() }),
  members: { add: method(Type.Object({ text: Type.String() })) },
  version: 1,
});

const Todos = remote("tutorial.todo-view", {
  host: hostNamed("server"),
  input: Type.Object({ list: Type.String() }),
  variants: {
    editor: {
      methods: { add: method(Type.Object({ text: Type.String() })) },
      state: { rows: Rows },
    },
    viewer: { state: { rows: Rows } },
  },
  version: 1,
});

type Principal = tutorialTypes.Principal;

function serveViews(api: Pick<Host<Principal>, "serve">): void {
  api.serve(Todos, ({ list }, principal, self) => {
    if (list !== "family") throw forbidden("This list is not shared");
    const store = self.get(TodoStore, { list });
    if (principal === "guest") {
      return { rows: store.rows, variant: "viewer" };
    }
    return {
      add: ({ text }, ctx) => {
        if (text.trim().length === 0) throw invalid("args", "A todo needs text");
        return store.add({ text }, ctx);
      },
      rows: store.rows,
      variant: "editor",
    };
  });
}

const tutorial = {
  Database,
  Rows,
  SavedTodos,
  Todo,
  TodoLabel,
  TodoStore,
  Todos,
  serveViews,
  todoStore,
};

export default tutorial;
