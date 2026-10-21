import tui from "@msa/tui";

import platform from "../../../core/platform/index.ts";
import type sessionManagerTypes from "../../../core/session-manager.types.ts";
import paths from "../../../utils/paths.ts";
import themeModule from "../theme/theme.ts";
import type sessionListInternalTypes from "./session-list-internal.types.ts";

const { nowMs, toDate } = platform;
const { canonicalizePath: _canonicalizePath } = paths;
const { theme } = themeModule;
const { truncateToWidth, visibleWidth } = tui;

function formatSessionDate(date: Date): string {
  const now = toDate(nowMs());
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "now";
  if (diffMins < 60) return `${diffMins}m`;
  if (diffHours < 24) return `${diffHours}h`;
  if (diffDays < 7) return `${diffDays}d`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo`;
  return `${Math.floor(diffDays / 365)}y`;
}

function canonicalPathMap(
  candidates: readonly (string | undefined)[],
): Promise<Map<string, string>> {
  const known = [...new Set(candidates)].filter(
    (path): path is string => path !== undefined && path !== "",
  );
  return Promise.all(
    known.map((path) => _canonicalizePath(path).then((canonical) => [path, canonical] as const)),
  ).then((entries) => new Map(entries));
}

const updateLatestActivity = (node: sessionListInternalTypes.SessionTreeNode): number => {
  let latestActivity = node.session.modified.getTime();
  for (const child of node.children) {
    latestActivity = Math.max(latestActivity, updateLatestActivity(child));
  }
  node.latestActivity = latestActivity;
  return latestActivity;
};

function buildSessionTree(
  sessions: sessionManagerTypes.SessionInfo[],
  canonical: (path: string) => string = (path) => path,
): sessionListInternalTypes.SessionTreeNode[] {
  const byPath = new Map<string, sessionListInternalTypes.SessionTreeNode>();

  for (const session of sessions) {
    const sessionPath = canonical(session.path);
    byPath.set(sessionPath, { children: [], latestActivity: session.modified.getTime(), session });
  }

  const roots: sessionListInternalTypes.SessionTreeNode[] = [];

  for (const session of sessions) {
    const sessionPath = canonical(session.path);
    const node = byPath.get(sessionPath)!;
    const parentPath =
      session.parentSessionPath === undefined || session.parentSessionPath === ""
        ? session.parentSessionPath
        : canonical(session.parentSessionPath);

    if (parentPath !== undefined && parentPath !== "" && byPath.has(parentPath)) {
      byPath.get(parentPath)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  for (const root of roots) {
    updateLatestActivity(root);
  }

  const sortNodes = (nodes: sessionListInternalTypes.SessionTreeNode[]): void => {
    nodes.sort((a, b) => b.latestActivity - a.latestActivity);
    for (const node of nodes) {
      sortNodes(node.children);
    }
  };
  sortNodes(roots);

  return roots;
}

function flattenSessionTree(
  roots: sessionListInternalTypes.SessionTreeNode[],
): sessionListInternalTypes.FlatSessionNode[] {
  const result: sessionListInternalTypes.FlatSessionNode[] = [];

  const walk = (
    node: sessionListInternalTypes.SessionTreeNode,
    depth: number,
    ancestorContinues: boolean[],
    isLast: boolean,
  ): void => {
    result.push({ ancestorContinues, depth, isLast, session: node.session });

    for (let i = 0; i < node.children.length; i++) {
      const childIsLast = i === node.children.length - 1;
      const continues = depth > 0 ? !isLast : false;
      walk(node.children[i]!, depth + 1, [...ancestorContinues, continues], childIsLast);
    }
  };

  for (let i = 0; i < roots.length; i++) {
    walk(roots[i]!, 0, [], i === roots.length - 1);
  }

  return result;
}

function appendSessionLine(
  cursor: string,
  prefix: string,
  styledMsg: string,
  width: number,
  rightPart: string,
  isConfirmingDelete: boolean,
  isSelected: boolean,
  lines: string[],
): void {
  const leftPart = cursor + theme.fg("dim", prefix) + styledMsg;
  const leftWidth = visibleWidth(leftPart);
  const spacing = Math.max(1, width - leftWidth - visibleWidth(rightPart));
  const styledRight = theme.fg(isConfirmingDelete ? "error" : "dim", rightPart);

  let line = leftPart + " ".repeat(spacing) + styledRight;
  if (isSelected) {
    line = theme.bg("selectedBg", line);
  }
  lines.push(truncateToWidth(line, width));
}

const sessionListHelpers = {
  appendSessionLine,
  buildSessionTree,
  canonicalPathMap,
  flattenSessionTree,
  formatSessionDate,
};

export default sessionListHelpers;
