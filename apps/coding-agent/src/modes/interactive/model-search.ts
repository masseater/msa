import type modelSearchTypes from "./model-search.types.ts";

function getModelSearchText(item: modelSearchTypes.ModelSearchItem): string {
  const { id, provider } = item;
  const name = item.name !== undefined && item.name !== "" ? ` ${item.name}` : "";
  return `${id} ${provider} ${provider}/${id} ${provider} ${id}${name}`;
}

function getModelSelectorSearchText(item: modelSearchTypes.ModelSearchItem): string {
  const { id, provider } = item;
  const name = item.name !== undefined && item.name !== "" ? ` ${item.name}` : "";
  return `${provider} ${provider}/${id} ${provider} ${id}${name}`;
}

const modelSearch = {
  getModelSearchText,
  getModelSelectorSearchText,
};

export default modelSearch;
