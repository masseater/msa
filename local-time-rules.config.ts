import type restrictedMemberTypes from "./tools/oxlint/restricted-member.types.ts";

const LOCAL_TIME_VIA_CHORD =
  "ローカルの時刻を文字列にするのは @msa/chord/local-time の format だけにする（coding-agent からは platform の formatLocalTime・formatLocalDateTime）";

const owners = {
  dateGetters: "apps/coding-agent/src/utils/zip.ts",
  localZone: "libs/chord/src/local-time.ts",
} as const;

const zoneMembers: readonly restrictedMemberTypes.RestrictedMember[] = [
  "formatLocal",
  "layerCurrentZoneLocal",
  "withCurrentZoneLocal",
  "zoneMakeLocal",
].flatMap((name) => [
  { message: LOCAL_TIME_VIA_CHORD, module: "effect", path: ["DateTime", name] },
  { message: LOCAL_TIME_VIA_CHORD, module: "effect/DateTime", path: [name] },
]);

const localTimeRules = { message: LOCAL_TIME_VIA_CHORD, owners, zoneMembers };

export default localTimeRules;
