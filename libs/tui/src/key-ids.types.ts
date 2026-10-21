declare namespace keyIdsTypes {
  type Letter =
    | "a"
    | "b"
    | "c"
    | "d"
    | "e"
    | "f"
    | "g"
    | "h"
    | "i"
    | "j"
    | "k"
    | "l"
    | "m"
    | "n"
    | "o"
    | "p"
    | "q"
    | "r"
    | "s"
    | "t"
    | "u"
    | "v"
    | "w"
    | "x"
    | "y"
    | "z";

  type Digit = "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9";

  type SymbolKey =
    | "`"
    | "-"
    | "="
    | "["
    | "]"
    | "\\"
    | ";"
    | "'"
    | ","
    | "."
    | "/"
    | "!"
    | "@"
    | "#"
    | "$"
    | "%"
    | "^"
    | "&"
    | "*"
    | "("
    | ")"
    | "_"
    | "+"
    | "|"
    | "~"
    | "{"
    | "}"
    | ":"
    | "<"
    | ">"
    | "?";

  type SpecialKey =
    | "escape"
    | "esc"
    | "enter"
    | "return"
    | "tab"
    | "space"
    | "backspace"
    | "delete"
    | "insert"
    | "clear"
    | "home"
    | "end"
    | "pageUp"
    | "pageDown"
    | "up"
    | "down"
    | "left"
    | "right"
    | "f1"
    | "f2"
    | "f3"
    | "f4"
    | "f5"
    | "f6"
    | "f7"
    | "f8"
    | "f9"
    | "f10"
    | "f11"
    | "f12";

  type BaseKey = Letter | Digit | SymbolKey | SpecialKey;

  type ModifierName = "ctrl" | "shift" | "alt" | "super";

  type ModifiedKeyId<Key extends string, RemainingModifiers extends ModifierName = ModifierName> = {
    [M in RemainingModifiers]:
      | `${M}+${Key}`
      | `${M}+${ModifiedKeyId<Key, Exclude<RemainingModifiers, M>>}`;
  }[RemainingModifiers];

  type KeyId = BaseKey | ModifiedKeyId<BaseKey>;
}

export type { keyIdsTypes as default };
