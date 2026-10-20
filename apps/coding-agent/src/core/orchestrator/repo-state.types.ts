declare namespace repoStateTypes {
  interface RepoState {
    branch: string;
    commit: string;
    changedFiles: number;
    unpushedCommits: number;
  }
}

export type { repoStateTypes as default };
