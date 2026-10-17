import { type Static, Type } from "typebox";

import {
  type Factory,
  forbidden,
  type Host,
  hostNamed,
  invalid,
  local,
  method,
  opaque,
  remote,
  type StateOptions,
} from "../../src/index.ts";

export const TodoLabel = local("tutorial.todos", {
  version: 1,
  input: Type.Object({ list: Type.String() }),
  members: { label: method(undefined, Type.String()) },
});

export const Todo = Type.Object({ text: Type.String(), done: Type.Boolean() });
export const Rows = Type.Array(Todo);
export const TodoStore = local("tutorial.todos", {
  version: 1,
  input: Type.Object({ list: Type.String() }),
  members: {
    label: method(undefined, Type.String()),
    rows: Rows,
    openCount: Type.Number(),
    add: method(Type.Object({ text: Type.String() })),
    finish: method(Type.Object({ index: Type.Integer() })),
    reset: method(Rows),
  },
});

export const todoStore =
  (options?: StateOptions<Static<typeof Rows>>): Factory<typeof TodoStore> =>
  ({ list }, _principal, self) => {
    const rows = self.state("rows", Rows, [], options);
    const openCount = self.derive([rows], (todos) => todos.filter((todo) => !todo.done).length);
    return {
      label: () => `Todos for ${list}`,
      rows,
      openCount,
      add: ({ text }, ctx) => {
        rows.change(ctx, (draft) => {
          draft.push({ text, done: false });
        });
      },
      finish: ({ index }, ctx) => {
        rows.change(ctx, (draft) => {
          const todo = draft[index];
          if (todo === undefined) throw invalid("args", "No such todo");
          todo.done = true;
        });
      },
      reset: (next, ctx) => {
        rows.replace(ctx, next, { diff: true });
      },
    };
  };

export const Database = local("tutorial.database", {
  version: 1,
  input: Type.Object({}),
  members: { db: opaque<{ saved: string[] }>("tutorial.database@1") },
});
export const SavedTodos = local("tutorial.saved-todos", {
  version: 1,
  input: Type.Object({ list: Type.String() }),
  members: { add: method(Type.Object({ text: Type.String() })) },
});

export const Todos = remote("tutorial.todo-view", {
  version: 1,
  input: Type.Object({ list: Type.String() }),
  host: hostNamed("server"),
  variants: {
    viewer: { state: { rows: Rows } },
    editor: {
      state: { rows: Rows },
      methods: { add: method(Type.Object({ text: Type.String() })) },
    },
  },
});

export type Principal = "owner" | "guest" | "server";

export function serveViews(api: Pick<Host<Principal>, "serve">): void {
  api.serve(Todos, ({ list }, principal, self) => {
    if (list !== "family") throw forbidden("This list is not shared");
    const store = self.get(TodoStore, { list });
    if (principal === "guest") {
      return { variant: "viewer", rows: store.rows };
    }
    return {
      variant: "editor",
      rows: store.rows,
      add: ({ text }, ctx) => {
        if (text.trim().length === 0) throw invalid("args", "A todo needs text");
        return store.add({ text }, ctx);
      },
    };
  });
}
