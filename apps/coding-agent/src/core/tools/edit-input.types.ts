import type { Static } from "typebox";

import type editSchemaModule from "./edit-schema.ts";

declare namespace editInputTypes {
  type EditToolInput = Static<typeof editSchemaModule.editSchema>;
}

export type { editInputTypes as default };
