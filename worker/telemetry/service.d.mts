import type { CompareConfig } from "./types";
export type Task =
  | { kind: "seasons" }
  | { kind: "meetings"; season: number }
  | { kind: "sessions"; meeting: number }
  | { kind: "catalog"; session: number }
  | { kind: "race-pace"; session: number }
  | { kind: "report-timing"; session: number }
  | { kind: "compare"; config: CompareConfig };
export function resultKey(task: Task): string;
export function validateTask(input: unknown): Task;
