declare namespace resolveConfigValueInternalTypes {
  type TemplatePart = { type: "literal"; value: string } | { type: "env"; name: string };

  type ConfigValueReference =
    | { type: "command"; config: string }
    | { type: "template"; parts: TemplatePart[] };
}

export type { resolveConfigValueInternalTypes as default };
