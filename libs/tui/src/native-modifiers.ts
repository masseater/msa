import nativePlatform from "./native-platform.ts";
import type nativePlatformTypes from "./native-platform.types.ts";

const { getNativePlatformHelper } = nativePlatform;

function isNativeModifierPressed(key: nativePlatformTypes.ModifierKey): boolean {
  const helper = getNativePlatformHelper();
  if (helper?.isModifierPressed === undefined) return false;
  try {
    return helper.isModifierPressed(key) === true;
  } catch {
    return false;
  }
}

const nativeModifiers = {
  isNativeModifierPressed,
};

export default nativeModifiers;
