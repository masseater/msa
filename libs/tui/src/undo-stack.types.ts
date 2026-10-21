import type UndoStackClass from "./undo-stack.ts";

declare namespace undoStackTypes {
  type UndoStack<S> = UndoStackClass<S>;
}

export type { undoStackTypes as default };
