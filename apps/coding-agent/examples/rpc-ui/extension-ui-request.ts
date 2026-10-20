declare namespace extensionUiRequestTypes {
  interface ExtensionUIRequest {
    type: "extension_ui_request";
    id: string;
    method: string;
    title?: string;
    options?: string[];
    message?: string;
    placeholder?: string;
    prefill?: string;
    notifyType?: "info" | "warning" | "error";
    statusKey?: string;
    statusText?: string;
    widgetKey?: string;
    widgetLines?: string[];
    text?: string;
  }
}

export type { extensionUiRequestTypes as default };
