import type compactionTypesTypes from "./compaction-types.types.ts";

const DEFAULT_COMPACTION_SETTINGS: compactionTypesTypes.CompactionSettings = {
  enabled: true,
  keepRecentTokens: 20000,
  reserveTokens: 16384,
};

const compactionTypes = {
  DEFAULT_COMPACTION_SETTINGS,
};

export default compactionTypes;
