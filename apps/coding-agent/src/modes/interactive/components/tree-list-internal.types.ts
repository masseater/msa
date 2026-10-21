import type sessionManagerTypes from "../../../core/session-manager.types.ts";

declare namespace treeListInternalTypes {
  interface GutterInfo {
    position: number;
    show: boolean;
  }

  interface FlatNode {
    node: sessionManagerTypes.SessionTreeNode;
    indent: number;
    showConnector: boolean;
    isLast: boolean;
    gutters: GutterInfo[];
    isVirtualRootChild: boolean;
  }

  interface HorizontalViewportRow {
    gutter: string;
    body: string;
    anchorCol: number;
    bodyWidth: number;
    isSelected: boolean;
  }

  interface ToolCallInfo {
    name: string;
    arguments: Record<string, unknown>;
  }
}

export type { treeListInternalTypes as default };
