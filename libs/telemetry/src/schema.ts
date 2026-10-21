import type schemaTypes from "./schema.types.ts";

function defineTelemetrySchema<const T extends schemaTypes.TelemetrySchemaDefinition>(
  schema: T,
): T {
  return schema;
}

const schemaModule = {
  defineTelemetrySchema,
};

export default schemaModule;
