import type cancellableLoaderTypes from "../components/cancellable-loader.types.ts";
import type editorTypes from "../components/editor.types.ts";
import type inputTypes from "../components/input.types.ts";
import type loaderTypes from "../components/loader.types.ts";
import type selectListTypes from "../components/select-list.types.ts";
import type settingsListItemsTypes from "../components/settings-list-items.types.ts";
import type settingsListTypes from "../components/settings-list.types.ts";

declare namespace tuiWidgetsKitTypes {
  type EditorOptions = editorTypes.EditorOptions;
  type EditorTheme = editorTypes.EditorTheme;
  type LoaderIndicatorOptions = loaderTypes.LoaderIndicatorOptions;
  type Editor = editorTypes.Editor;
  type Loader = loaderTypes.Loader;
  type SelectItem = selectListTypes.SelectItem;
  type SelectListLayoutOptions = selectListTypes.SelectListLayoutOptions;
  type SelectListTheme = selectListTypes.SelectListTheme;
  type SelectListTruncatePrimaryContext = selectListTypes.SelectListTruncatePrimaryContext;
  type SettingItem = settingsListItemsTypes.SettingItem;
  type SettingsListTheme = settingsListItemsTypes.SettingsListTheme;
  type SelectList = selectListTypes.SelectList;
  type CancellableLoader = cancellableLoaderTypes.CancellableLoader;
  type Input = inputTypes.Input;
  type SettingsList = settingsListTypes.SettingsList;
}

export type { tuiWidgetsKitTypes as default };
