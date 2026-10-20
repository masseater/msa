declare namespace handoffFilesTypes {
  interface PendingHandoff {
    name: string;
    path: string;
    createdAt: number;
    tasks: number;
  }
}

export type { handoffFilesTypes as default };
