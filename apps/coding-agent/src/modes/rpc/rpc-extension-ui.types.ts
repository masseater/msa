declare namespace rpcExtensionUiTypes {
  type RpcExtensionUIRequest =
    | {
        type: "extension_ui_request";
        id: string;
        method: "select";
        title: string;
        options: string[];
        timeout?: number | undefined;
      }
    | {
        type: "extension_ui_request";
        id: string;
        method: "confirm";
        title: string;
        message: string;
        timeout?: number | undefined;
      }
    | {
        type: "extension_ui_request";
        id: string;
        method: "input";
        title: string;
        placeholder?: string | undefined;
        timeout?: number | undefined;
      }
    | {
        type: "extension_ui_request";
        id: string;
        method: "editor";
        title: string;
        prefill?: string | undefined;
      }
    | {
        type: "extension_ui_request";
        id: string;
        method: "notify";
        message: string;
        notifyType?: "info" | "warning" | "error" | undefined;
      }
    | {
        type: "extension_ui_request";
        id: string;
        method: "setStatus";
        statusKey: string;
        statusText: string | undefined;
      }
    | {
        type: "extension_ui_request";
        id: string;
        method: "setWidget";
        widgetKey: string;
        widgetLines: string[] | undefined;
        widgetPlacement?: "aboveEditor" | "belowEditor" | undefined;
      }
    | { type: "extension_ui_request"; id: string; method: "setTitle"; title: string }
    | { type: "extension_ui_request"; id: string; method: "set_editor_text"; text: string };

  type RpcExtensionUIResponse =
    | { type: "extension_ui_response"; id: string; value: string }
    | { type: "extension_ui_response"; id: string; confirmed: boolean }
    | { type: "extension_ui_response"; id: string; cancelled: true };
}

export type { rpcExtensionUiTypes as default };
