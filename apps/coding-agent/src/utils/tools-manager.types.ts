declare namespace toolsManagerTypes {
  interface ToolStatus {
    type: "info" | "warning";
    message: string;
  }
}

export type { toolsManagerTypes as default };
