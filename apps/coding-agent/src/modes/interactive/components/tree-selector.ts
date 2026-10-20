import tui from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";

import platform from "../../../core/platform.ts";
import type sessionManagerTypes from "../../../core/session-manager.types.ts";
import themeModule from "../theme/theme.ts";
import DynamicBorder from "./dynamic-border.ts";
import LabelInput from "./label-input.ts";
import SearchLine from "./search-line.ts";
import TreeHelp from "./tree-help.ts";
import TreeList from "./tree-list.ts";
import type treeSelectorTypes from "./tree-selector.types.ts";

const { schedule } = platform;
const { theme } = themeModule;
const { Container, Spacer, Text } = tui;

export default class TreeSelectorComponent extends tui.Container implements tuiTypes.Focusable {
  private treeList: TreeList;
  private labelInput: LabelInput | null = null;
  private labelInputContainer: tuiTypes.Container;
  private treeContainer: tuiTypes.Container;
  private onLabelChangeCallback?:
    | ((entryId: string, label: string | undefined) => void)
    | undefined;
  public onCopy?: (text: string | undefined) => void;

  private focusedState = false;
  get focused(): boolean {
    return this.focusedState;
  }
  set focused(value: boolean) {
    this.focusedState = value;
    if (this.labelInput !== null) {
      this.labelInput.focused = value;
    }
  }

  constructor(
    tree: sessionManagerTypes.SessionTreeNode[],
    currentLeafId: string | null,
    terminalHeight: number,
    onSelect: (entryId: string) => void,
    onCancel: () => void,
    onLabelChange?: (entryId: string, label: string | undefined) => void,
    initialSelectedId?: string,
    initialFilterMode?: treeSelectorTypes.FilterMode,
  ) {
    super();

    this.onLabelChangeCallback = onLabelChange;
    const maxVisibleLines = Math.max(5, Math.floor(terminalHeight / 2));

    this.treeList = new TreeList(
      tree,
      currentLeafId,
      maxVisibleLines,
      initialSelectedId,
      initialFilterMode,
    );
    this.treeList.onSelect = onSelect;
    this.treeList.onCancel = onCancel;
    this.treeList.onCopy = (text) => this.onCopy?.(text);
    this.treeList.onLabelEdit = (entryId, currentLabel) =>
      this.showLabelInput(entryId, currentLabel);

    this.treeContainer = new Container();
    this.treeContainer.addChild(this.treeList);

    this.labelInputContainer = new Container();

    this.addChild(new Spacer(1));
    this.addChild(new DynamicBorder());
    this.addChild(new Text(theme.bold("  Session Tree"), 1, 0));
    this.addChild(new TreeHelp());
    this.addChild(new SearchLine(this.treeList));
    this.addChild(new DynamicBorder());
    this.addChild(new Spacer(1));
    this.addChild(this.treeContainer);
    this.addChild(this.labelInputContainer);
    this.addChild(new Spacer(1));
    this.addChild(new DynamicBorder());

    if (tree.length === 0) {
      schedule(() => onCancel(), 100);
    }
  }

  private showLabelInput(entryId: string, currentLabel: string | undefined): void {
    this.labelInput = new LabelInput(entryId, currentLabel);
    this.labelInput.onSubmit = (id, label) => {
      this.treeList.updateNodeLabel(id, label);
      this.onLabelChangeCallback?.(id, label);
      this.hideLabelInput();
    };
    this.labelInput.onCancel = () => this.hideLabelInput();

    this.labelInput.focused = this.focusedState;

    this.treeContainer.clear();
    this.labelInputContainer.clear();
    this.labelInputContainer.addChild(this.labelInput);
  }

  private hideLabelInput(): void {
    this.labelInput = null;
    this.labelInputContainer.clear();
    this.treeContainer.clear();
    this.treeContainer.addChild(this.treeList);
  }

  handleInput(keyData: string): void {
    if (this.labelInput === null) {
      this.treeList.handleInput(keyData);
    } else {
      this.labelInput.handleInput(keyData);
    }
  }

  getTreeList(): TreeList {
    return this.treeList;
  }
}
