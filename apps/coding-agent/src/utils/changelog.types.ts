declare namespace changelogTypes {
  interface ChangelogEntry {
    major: number;
    minor: number;
    patch: number;
    content: string;
  }
}

export type { changelogTypes as default };
