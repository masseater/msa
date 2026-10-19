import {
  Container,
  type Focusable,
  getKeybindings,
  type SelectItem,
  SelectList,
  type SelectListLayoutOptions,
  Spacer,
  Text,
} from "@msa/tui";

import type { ModelUpgradeCandidate } from "../../../core/model-upgrade.ts";
import { getSelectListTheme, theme } from "../theme/theme.ts";
import { DynamicBorder } from "./dynamic-border.ts";
import { keyDisplayText } from "./keybinding-hints.ts";

const UPGRADE_SELECT_LIST_LAYOUT: SelectListLayoutOptions = {
  minPrimaryColumnWidth: 40,
  maxPrimaryColumnWidth: 72,
};

export interface ModelUpgradeCallbacks {
  onApply(candidate: ModelUpgradeCandidate): Promise<string>;
  onCancel: () => void;
  requestRender: () => void;
}

export class ModelUpgradeSelectorComponent extends Container implements Focusable {
  private selectList: SelectList;
  private selectListChildIndex: number;
  private statusText: Text;
  private candidates: ModelUpgradeCandidate[];
  private callbacks: ModelUpgradeCallbacks;
  private _focused = false;

  get focused(): boolean {
    return this._focused;
  }

  set focused(value: boolean) {
    this._focused = value;
  }

  constructor(candidates: ModelUpgradeCandidate[], callbacks: ModelUpgradeCallbacks) {
    super();
    this.candidates = candidates;
    this.callbacks = callbacks;

    this.addChild(new DynamicBorder());
    this.addChild(new Spacer(1));
    this.addChild(new Text(theme.fg("accent", theme.bold("Model Upgrades")), 0, 0));
    this.addChild(new Spacer(1));

    this.selectList = this.buildSelectList(candidates);
    this.selectListChildIndex = this.children.length;
    this.addChild(this.selectList);

    this.addChild(new Spacer(1));
    this.statusText = new Text("", 0, 0);
    this.addChild(this.statusText);
    this.addChild(
      new Text(
        theme.fg(
          "dim",
          `  ${keyDisplayText("tui.select.confirm")} apply · ${keyDisplayText("tui.select.cancel")} cancel`,
        ),
        0,
        0,
      ),
    );
    this.addChild(new DynamicBorder());
  }

  private buildSelectList(candidates: readonly ModelUpgradeCandidate[]): SelectList {
    const items: SelectItem[] = candidates.map((candidate) => ({
      value: `${candidate.from.provider}/${candidate.from.id}`,
      label: `${candidate.from.id} → ${candidate.to.id}`,
      description: `${candidate.from.provider} · ${candidate.reason}${candidate.confident ? "" : " · candidate"}`,
    }));
    const list = new SelectList(items, 10, getSelectListTheme(), UPGRADE_SELECT_LIST_LAYOUT);
    list.onSelect = (item) => void this.apply(item.value);
    list.onCancel = () => this.callbacks.onCancel();
    return list;
  }

  private async apply(reference: string): Promise<void> {
    const candidate = this.candidates.find(
      (entry) => `${entry.from.provider}/${entry.from.id}` === reference,
    );
    if (!candidate) return;
    if (!candidate.confident) {
      this.statusText.setText(
        theme.fg("warning", `  ${reference} needs a decision: ${candidate.reason}`),
      );
      this.callbacks.requestRender();
      return;
    }
    try {
      const message = await this.callbacks.onApply(candidate);
      this.candidates = this.candidates.filter((entry) => entry !== candidate);
      this.replaceList();
      this.statusText.setText(theme.fg("success", `  ${message}`));
    } catch (error) {
      this.statusText.setText(
        theme.fg("error", `  ${error instanceof Error ? error.message : String(error)}`),
      );
    }
    this.callbacks.requestRender();
  }

  private replaceList(): void {
    this.selectList = this.buildSelectList(this.candidates);
    this.children[this.selectListChildIndex] = this.selectList;
  }

  handleInput(keyData: string): void {
    const kb = getKeybindings();
    if (kb.matches(keyData, "tui.select.up") || kb.matches(keyData, "tui.select.down")) {
      this.selectList.handleInput(keyData);
      return;
    }
    if (kb.matches(keyData, "tui.select.confirm")) {
      this.selectList.handleInput(keyData);
      return;
    }
    if (kb.matches(keyData, "tui.select.cancel")) {
      this.callbacks.onCancel();
    }
  }

  getSelectList(): SelectList {
    return this.selectList;
  }
}
