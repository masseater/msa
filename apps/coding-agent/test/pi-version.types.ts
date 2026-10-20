declare namespace piVersionTypes {
  type ParsedPiVersion = readonly [major: number, minor: number, patch: number, prerelease: string];
}

export type { piVersionTypes as default };
