import { type TSchema, Type } from "typebox";

import keyIdSchema from "./key-id-schema.ts";
import keybindings from "./keybindings.ts";

const { KeybindingValueSchema, keybindingValueSchema } = keyIdSchema;
const { KEYBINDINGS } = keybindings;

const properties: Record<string, TSchema> = {
  $schema: Type.Optional(Type.String()),
  ...Object.fromEntries(
    Object.entries(KEYBINDINGS).map(([id, definition]) => [
      id,
      Type.Optional(keybindingValueSchema({ description: definition.description })),
    ]),
  ),
};

const KeybindingsSchema = Type.Object(properties, {
  additionalProperties: KeybindingValueSchema,
});

const keybindingsSchema = {
  KeybindingValueSchema: keyIdSchema.KeybindingValueSchema,
  KeybindingsSchema,
};

export default keybindingsSchema;
