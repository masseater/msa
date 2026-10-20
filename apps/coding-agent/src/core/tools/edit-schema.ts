import { Type } from "typebox";

const replaceEditSchema = Type.Object(
  {
    newText: Type.String({ description: "Replacement text for this targeted edit." }),
    oldText: Type.String({
      description:
        "Exact text for one targeted replacement. It must be unique in the original file and must not overlap with any other edits[].oldText in the same call.",
    }),
  },
  {},
);

const editSchema = Type.Object(
  {
    edits: Type.Array(replaceEditSchema, {
      description:
        "One or more targeted replacements. Each edit is matched against the original file, not incrementally. Do not include overlapping or nested edits. If two changes touch the same block or nearby lines, merge them into one edit instead.",
    }),
    path: Type.String({ description: "Path to the file to edit (relative or absolute)" }),
  },
  {},
);

const editSchemaModule = {
  editSchema,
};

export default editSchemaModule;
