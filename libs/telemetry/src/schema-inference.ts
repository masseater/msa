import type contextTypes from "./context.ts";
import type schemaTypes from "./schema.types.ts";

declare namespace schemaInferenceTypes {
  type AttributeDefinitionValue<Definition extends schemaTypes.TelemetryAttributeDefinition> =
    Definition extends {
      type: "string";
      values: readonly (infer Value extends string)[];
    }
      ? Value
      : Definition extends { type: "string" }
        ? string
        : Definition extends { type: "number"; values: readonly (infer Value extends number)[] }
          ? Value
          : Definition extends { type: "number" }
            ? number
            : Definition extends {
                  type: "boolean";
                  values: readonly (infer Value extends boolean)[];
                }
              ? Value
              : Definition extends { type: "boolean" }
                ? boolean
                : Definition extends {
                      type: "string[]";
                      elementValues: readonly (infer Value extends string)[];
                    }
                  ? readonly Value[]
                  : Definition extends { type: "string[]" }
                    ? readonly string[]
                    : Definition extends {
                          type: "number[]";
                          elementValues: readonly (infer Value extends number)[];
                        }
                      ? readonly Value[]
                      : Definition extends { type: "number[]" }
                        ? readonly number[]
                        : Definition extends {
                              type: "boolean[]";
                              elementValues: readonly (infer Value extends boolean)[];
                            }
                          ? readonly Value[]
                          : readonly boolean[];

  type RequiredAttributeNames<
    Definitions extends Record<
      string,
      schemaTypes.TelemetryStartAttributeDefinition | schemaTypes.TelemetryEventAttributeDefinition
    >,
  > = {
    [Name in keyof Definitions]-?: Definitions[Name]["required"] extends true ? Name : never;
  }[keyof Definitions];

  type OptionalAttributeNames<
    Definitions extends Record<
      string,
      schemaTypes.TelemetryStartAttributeDefinition | schemaTypes.TelemetryEventAttributeDefinition
    >,
  > = Exclude<keyof Definitions, RequiredAttributeNames<Definitions>>;

  type InferRequiredAndOptionalAttributes<
    Definitions extends Record<
      string,
      schemaTypes.TelemetryStartAttributeDefinition | schemaTypes.TelemetryEventAttributeDefinition
    >,
  > = keyof Definitions extends never
    ? Record<string, never>
    : {
        [Name in RequiredAttributeNames<Definitions>]: AttributeDefinitionValue<Definitions[Name]>;
      } & {
        [Name in OptionalAttributeNames<Definitions>]?: AttributeDefinitionValue<Definitions[Name]>;
      };

  type InferStartAttributes<
    Definitions extends Record<string, schemaTypes.TelemetryStartAttributeDefinition>,
  > = InferRequiredAndOptionalAttributes<Definitions>;

  type InferOptionalAttributes<
    Definitions extends Record<string, schemaTypes.TelemetryAttributeDefinition>,
  > = keyof Definitions extends never
    ? Record<string, never>
    : { [Name in keyof Definitions]?: AttributeDefinitionValue<Definitions[Name]> };

  type ExactTelemetryAttributes<Expected, Actual extends Expected> = Actual &
    Record<Exclude<keyof Actual, keyof Expected>, never>;

  type InferEventAttributes<
    Definitions extends Record<string, schemaTypes.TelemetryEventAttributeDefinition>,
  > = InferRequiredAndOptionalAttributes<Definitions>;

  type TelemetrySchemaSpanName<Schema extends schemaTypes.TelemetrySchemaDefinition> =
    keyof Schema["spans"] & string;

  type SchemaSpan<
    Schema extends schemaTypes.TelemetrySchemaDefinition,
    Name extends TelemetrySchemaSpanName<Schema>,
  > = Schema["spans"][Name];

  type TelemetrySchemaSpanStartAttributes<
    Schema extends schemaTypes.TelemetrySchemaDefinition,
    Name extends TelemetrySchemaSpanName<Schema>,
  > = SchemaSpan<Schema, Name>["startAttributes"] extends infer Definitions extends Record<
    string,
    schemaTypes.TelemetryStartAttributeDefinition
  >
    ? InferStartAttributes<Definitions>
    : never;

  type TelemetrySchemaSpanEndAttributes<
    Schema extends schemaTypes.TelemetrySchemaDefinition,
    Name extends TelemetrySchemaSpanName<Schema>,
  > = SchemaSpan<Schema, Name>["endAttributes"] extends infer Definitions extends Record<
    string,
    schemaTypes.TelemetryAttributeDefinition
  >
    ? InferOptionalAttributes<Definitions>
    : never;

  type SchemaSpanEvents<
    Schema extends schemaTypes.TelemetrySchemaDefinition,
    Name extends TelemetrySchemaSpanName<Schema>,
  > =
    SchemaSpan<Schema, Name> extends {
      events: infer Events extends Record<string, schemaTypes.TelemetryEventDefinition>;
    }
      ? Events
      : Record<never, never>;

  type TelemetrySchemaSpanEventName<
    Schema extends schemaTypes.TelemetrySchemaDefinition,
    Name extends TelemetrySchemaSpanName<Schema>,
  > = keyof SchemaSpanEvents<Schema, Name> & string;

  type SchemaSpanEvent<
    Schema extends schemaTypes.TelemetrySchemaDefinition,
    Name extends TelemetrySchemaSpanName<Schema>,
    EventName extends TelemetrySchemaSpanEventName<Schema, Name>,
  > =
    SchemaSpanEvents<Schema, Name> extends infer Events
      ? EventName extends keyof Events
        ? Events[EventName]
        : never
      : never;

  type TelemetrySchemaSpanEventAttributes<
    Schema extends schemaTypes.TelemetrySchemaDefinition,
    Name extends TelemetrySchemaSpanName<Schema>,
    EventName extends TelemetrySchemaSpanEventName<Schema, Name>,
  > =
    SchemaSpanEvent<Schema, Name, EventName> extends {
      attributes: infer Definitions extends Record<
        string,
        schemaTypes.TelemetryEventAttributeDefinition
      >;
    }
      ? InferEventAttributes<Definitions>
      : never;

  type SchemaSpanEventAttributeDefinitions<
    Schema extends schemaTypes.TelemetrySchemaDefinition,
    Name extends TelemetrySchemaSpanName<Schema>,
    EventName extends TelemetrySchemaSpanEventName<Schema, Name>,
  > =
    SchemaSpanEvent<Schema, Name, EventName> extends {
      attributes: infer Definitions extends Record<
        string,
        schemaTypes.TelemetryEventAttributeDefinition
      >;
    }
      ? Definitions
      : Record<never, never>;

  type EventArguments<
    Definitions extends Record<string, schemaTypes.TelemetryEventAttributeDefinition>,
    Attributes extends InferEventAttributes<Definitions>,
  > = [RequiredAttributeNames<Definitions>] extends [never]
    ? [attributes?: ExactTelemetryAttributes<InferEventAttributes<Definitions>, Attributes>]
    : [attributes: ExactTelemetryAttributes<InferEventAttributes<Definitions>, Attributes>];

  type SchemaTelemetrySpan<
    Schema extends schemaTypes.TelemetrySchemaDefinition,
    Name extends TelemetrySchemaSpanName<Schema>,
  > = Omit<contextTypes.TelemetrySpan, "addEvent" | "setAttributes"> & {
    addEvent<
      EventName extends TelemetrySchemaSpanEventName<Schema, Name>,
      const Attributes extends InferEventAttributes<
        SchemaSpanEventAttributeDefinitions<Schema, Name, EventName>
      > = InferEventAttributes<SchemaSpanEventAttributeDefinitions<Schema, Name, EventName>>,
    >(
      name: EventName,
      ...args: EventArguments<
        SchemaSpanEventAttributeDefinitions<Schema, Name, EventName>,
        Attributes
      >
    ): void;
    setAttributes<const Attributes extends TelemetrySchemaSpanEndAttributes<Schema, Name>>(
      attributes: ExactTelemetryAttributes<
        TelemetrySchemaSpanEndAttributes<Schema, Name>,
        Attributes
      >,
    ): void;
  };

  type TelemetrySchemaSpanUnion<Schema extends schemaTypes.TelemetrySchemaDefinition> = {
    [Name in TelemetrySchemaSpanName<Schema>]: {
      name: Name;
      startAttributes: TelemetrySchemaSpanStartAttributes<Schema, Name>;
      endAttributes: TelemetrySchemaSpanEndAttributes<Schema, Name>;
      events: {
        [
          EventName in TelemetrySchemaSpanEventName<Schema, Name>
        ]: TelemetrySchemaSpanEventAttributes<Schema, Name, EventName>;
      };
    };
  }[TelemetrySchemaSpanName<Schema>];
}

export type { schemaInferenceTypes as default };
