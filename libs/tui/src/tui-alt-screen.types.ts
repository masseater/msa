import type TuiAltScreenClass from "./tui-alt-screen.ts";
import type wheelScrollTypes from "./wheel-scroll.types.ts";

declare namespace tuiAltScreenTypes {
  interface TuiAltScreenOptions {
    wheelScrollLines?: wheelScrollTypes.WheelScrollLines;
    mouse?: boolean;
    searchMatchStyle?: (text: string) => string;
    searchCurrentMatchStyle?: (text: string) => string;
    searchNavigationButtonStyle?: (text: string, hovered: boolean) => string;
    scrollToEndIndicator?: () => string;
    openUrl?: (url: string) => void;
    onRightClickPaste?: () => void;
    copyOnSelect?: boolean;
    copySelection?: (text: string) => Promise<boolean | string>;
  }

  type TuiAltScreen = TuiAltScreenClass;
}

export type { tuiAltScreenTypes as default };
