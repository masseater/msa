import type { Static } from "typebox";

import type themeSchema from "./theme-schema.ts";

declare namespace themeSchemaTypes {
  type ThemeColorValue = Static<typeof themeSchema.ColorValueSchema>;

  type ValidatedThemeJson = Static<typeof themeSchema.ThemeJsonSchema>;
}

export type { themeSchemaTypes as default };
