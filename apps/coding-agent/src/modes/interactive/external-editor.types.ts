declare namespace externalEditorTypes {
  interface ExternalEditorOptions {
    command: string;
    content: string;
  }

  type ExternalEditorResult = { status: "complete"; content: string } | { status: "failed" };
}

export type { externalEditorTypes as default };
