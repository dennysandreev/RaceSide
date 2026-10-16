export type * from "../../../../worker/telemetry/types";

import type {
  Catalog as TelemetryCatalog,
  Meeting,
  Session,
} from "../../../../worker/telemetry/types";

export type TelemetrySetupCatalog = Pick<
  TelemetryCatalog,
  "session" | "drivers" | "laps"
>;

export type TelemetryBootstrapStage =
  | "demo"
  | "seasons"
  | "meetings"
  | "sessions"
  | "catalog"
  | "ready";

export type TelemetryBootstrapData = {
  seasons: number[];
  season: number | null;
  meetings: Meeting[];
  meeting: number | null;
  sessions: Session[];
  session: number | null;
  catalog: TelemetrySetupCatalog | null;
  stage: TelemetryBootstrapStage;
};

// Raw provider channels stay compatible with already cached comparisons.
export type Channel = Exclude<import("../../../../worker/telemetry/types").Channel, "drs">;
