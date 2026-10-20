import textTruncate from "../text-truncate.ts";
import textWrap from "../text-wrap.ts";
import utils from "../utils.ts";
import type settingsListItemsTypes from "./settings-list-items.types.ts";

const { truncateToWidth } = textTruncate;
const { visibleWidth } = utils;
const { wrapTextWithAnsi } = textWrap;

function visibleItemRange(request: {
  selectedIndex: number;
  maxVisible: number;
  itemCount: number;
}): { startIndex: number; endIndex: number } {
  const startIndex = Math.max(
    0,
    Math.min(
      request.selectedIndex - Math.floor(request.maxVisible / 2),
      request.itemCount - request.maxVisible,
    ),
  );
  return {
    endIndex: Math.min(startIndex + request.maxVisible, request.itemCount),
    startIndex,
  };
}

const settingsHint = (searchEnabled: boolean): string =>
  searchEnabled
    ? "  Type to search · Enter/Space to change · Esc to cancel"
    : "  Enter/Space to change · Esc to cancel";

function settingItemLine(
  theme: settingsListItemsTypes.SettingsListTheme,
  items: readonly settingsListItemsTypes.SettingItem[],
  line: { readonly item: settingsListItemsTypes.SettingItem; readonly isSelected: boolean },
  width: number,
): string {
  const { item, isSelected } = line;
  const maxLabelWidth = Math.min(36, Math.max(...items.map((each) => visibleWidth(each.label))));
  const prefix = isSelected ? theme.cursor : "  ";
  const labelPadded =
    item.label + " ".repeat(Math.max(0, maxLabelWidth - visibleWidth(item.label)));
  const labelText = theme.label(labelPadded, isSelected);
  const separator = "  ";
  const usedWidth = visibleWidth(prefix) + maxLabelWidth + visibleWidth(separator);
  const valueText = theme.value(
    truncateToWidth(item.currentValue, width - usedWidth - 2, ""),
    isSelected,
  );
  return truncateToWidth(prefix + labelText + separator + valueText, width);
}

function descriptionLines(
  theme: settingsListItemsTypes.SettingsListTheme,
  selectedItem: settingsListItemsTypes.SettingItem | undefined,
  width: number,
): string[] {
  if (selectedItem?.description === undefined || selectedItem.description === "") return [];
  return [
    "",
    ...wrapTextWithAnsi(selectedItem.description, width - 4).map((line) =>
      theme.description(`  ${line}`),
    ),
  ];
}

const settingsListItems = {
  descriptionLines,
  settingItemLine,
  settingsHint,
  visibleItemRange,
};

export default settingsListItems;
