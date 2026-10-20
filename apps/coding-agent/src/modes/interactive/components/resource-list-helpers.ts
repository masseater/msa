import type resourceListInternalTypes from "./resource-list-internal.types.ts";

const RESOURCE_TYPES = [
  "extensions",
  "skills",
  "prompts",
  "themes",
] as const satisfies readonly resourceListInternalTypes.ResourceType[];

const resourceListHelpers = { RESOURCE_TYPES };

export default resourceListHelpers;
