declare namespace externalEditorTypes {
  interface ExternalEditorOptions {
    command: string;
    content: string;
  }

  interface SuspendableUi {
    stop(): void;
    start(): void;
    requestRender(force?: boolean): void;
  }

  type ExternalEditorResult = { status: "complete"; content: string } | { status: "failed" };
}

export type { externalEditorTypes as default };
