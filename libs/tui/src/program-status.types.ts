declare namespace programStatusTypes {
  interface ProgramStatus {
    state: "idle" | "working" | "blocked" | "done" | "error" | "clear";
    app?: string;
    kind?: "permission" | "question" | "auth" | "quota";
    message?: string;
  }
}

export type { programStatusTypes as default };
