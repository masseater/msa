import type { Context } from "@msa/chord";
import type { Static } from "typebox";

import type envTypes from "../env/index.types.ts";
import type editDiffTypes from "./edit-diff.types.ts";
import type editDisplayTypes from "./edit-display.types.ts";
import type editModule from "./edit.ts";
import type envModule from "./env.ts";

declare namespace editTypes {
  type EditToolInput = Static<typeof editModule.editSchema>;

  type EditTarget = {
    readonly env: ReturnType<typeof envModule.requireEnv>;
    readonly path: string;
    readonly absolutePath: string;
    readonly context: Context;
  };

  type EditToolDetails = editDisplayTypes.EditToolDetails;

  type Edit = editDiffTypes.Edit;

  type FileError = envTypes.FileError;
}

export type { editTypes as default };
