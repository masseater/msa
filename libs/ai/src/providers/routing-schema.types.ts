import type { Static } from "typebox";

import type routingSchema from "./routing-schema.ts";

declare namespace routingSchemaTypes {
  interface OpenRouterRouting extends Static<typeof routingSchema.OpenRouterRoutingSchema> {}

  interface AnthropicAllowedFallbackModel extends Static<
    typeof routingSchema.AnthropicAllowedFallbackModelSchema
  > {}
}

export type { routingSchemaTypes as default };
