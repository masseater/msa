const LOCAL_TIME_VIA_CHORD =
  "ローカルの時刻を文字列にするのは @msa/chord/local-time の format だけにする（coding-agent からは platform の formatLocalTime・formatLocalDateTime）";

type RestrictedProperty = Readonly<{ object?: string; property: string; message: string }>;

type RestrictedMember = Readonly<{ module: string; path: readonly string[]; message: string }>;

const owners = {
  dateGetters: "apps/coding-agent/src/utils/zip.ts",
  localZone: "libs/chord/src/local-time.ts",
} as const;

const localDateMembers: readonly string[] = [
  "getDate",
  "getDay",
  "getFullYear",
  "getHours",
  "getMilliseconds",
  "getMinutes",
  "getMonth",
  "getSeconds",
  "getTimezoneOffset",
  "getYear",
  "toDateString",
  "toLocaleDateString",
  "toLocaleTimeString",
  "toTimeString",
];

const dateProperties: readonly RestrictedProperty[] = localDateMembers.map((property) => ({
  message: LOCAL_TIME_VIA_CHORD,
  property,
}));

const intlProperties: readonly RestrictedProperty[] = [
  { message: LOCAL_TIME_VIA_CHORD, object: "Intl", property: "DateTimeFormat" },
];

const zoneMembers: readonly RestrictedMember[] = [
  "formatLocal",
  "layerCurrentZoneLocal",
  "withCurrentZoneLocal",
  "zoneMakeLocal",
].flatMap((name) => [
  { message: LOCAL_TIME_VIA_CHORD, module: "effect", path: ["DateTime", name] },
  { message: LOCAL_TIME_VIA_CHORD, module: "effect/DateTime", path: [name] },
]);

const localTimeRules = { dateProperties, intlProperties, owners, zoneMembers };

export default localTimeRules;
