export type TimelinePatch = { path: (string | number)[]; value?: unknown; remove?: boolean };
export const REWIND_WINDOW_MS: number;
export function applyTimelinePatch<T>(state: T, patches: TimelinePatch[]): T;
