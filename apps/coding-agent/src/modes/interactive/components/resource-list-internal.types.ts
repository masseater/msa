import type packageManagerTypes from "../../../core/package-manager.types.ts";

declare namespace resourceListInternalTypes {
  type ResourceType = "extensions" | "skills" | "prompts" | "themes";

  type SettingsScope = "user" | "project";

  type ProjectOverrideState = "inherit" | "load" | "unload";

  interface ResourceItem {
    path: string;
    enabled: boolean;
    metadata: packageManagerTypes.PathMetadata;
    resourceType: ResourceType;
    displayName: string;
    groupKey: string;
    subgroupKey: string;
  }

  interface ResourceSubgroup {
    type: ResourceType;
    label: string;
    items: ResourceItem[];
  }

  interface ResourceGroup {
    key: string;
    label: string;
    scope: "user" | "project" | "temporary";
    origin: "package" | "top-level";
    source: string;
    subgroups: ResourceSubgroup[];
  }

  type FlatEntry =
    | { type: "group"; group: ResourceGroup }
    | { type: "subgroup"; subgroup: ResourceSubgroup; group: ResourceGroup }
    | { type: "item"; item: ResourceItem };
}

export type { resourceListInternalTypes as default };
