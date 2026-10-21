import { Type } from "typebox";

import chord from "../../src/index.ts";

const { local, method } = chord;

const Notes = local("t.notes", {
  input: Type.Object({}),
  members: {
    add: method(Type.String()),
    count: Type.Number(),
    has: method(Type.String(), Type.Boolean()),
    notes: Type.Array(Type.String()),
  },
  version: 1,
});

const NotesSchema = Type.Array(Type.String());

const stateNotes = { Notes, NotesSchema };

export default stateNotes;
