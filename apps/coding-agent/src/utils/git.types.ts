declare namespace gitTypes {
  type GitSource = {
    type: "git";

    repo: string;

    host: string;

    path: string;

    ref?: string | undefined;

    pinned: boolean;
  };
}

export type { gitTypes as default };
