import type expandableTextTypes from "./expandable-text.types.ts";

function isExpandable(obj: unknown): obj is expandableTextTypes.Expandable {
  return (
    typeof obj === "object" &&
    obj !== null &&
    "setExpanded" in obj &&
    typeof obj.setExpanded === "function"
  );
}

const expandableTextSupport = {
  isExpandable,
};

export default expandableTextSupport;
