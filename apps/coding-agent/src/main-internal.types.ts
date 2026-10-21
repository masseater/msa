declare namespace mainInternalTypes {
  type ResolvedSession =
    | { type: "path"; path: string }
    | { type: "local"; path: string }
    | { type: "global"; path: string; cwd: string }
    | { type: "not_found"; arg: string };
}

export type { mainInternalTypes as default };
