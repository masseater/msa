import type TodoListComponentClass from "./todo-list.ts";

declare namespace todoListTypes {
  interface Todo {
    id: number;
    text: string;
    done: boolean;
  }

  type TodoListComponent = (typeof TodoListComponentClass)["prototype"];
}

export type { todoListTypes as default };
