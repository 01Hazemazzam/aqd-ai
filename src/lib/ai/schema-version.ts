// The version of the extraction contract an Analysis was produced under.
//
// Raise this whenever a change to the prompts makes an older Analysis
// materially incomplete -- not for a wording tweak, but for a new field the
// product depends on. Raising it makes every contract miss the analysis cache
// once and re-analyse on demand, and marks existing analyses as outdated in
// the UI so the missing data is explained rather than mysterious.
//
// Version history:
//   0  every analysis predating this constant
//   1  obligations carry a due specification (offset/unit/direction/anchor)
//      and a party role -- ADR-0003
export const ANALYSIS_SCHEMA_VERSION = 1

/** Whether an analysis was produced by the current extraction schema. */
export function isCurrentSchema(version: number | null | undefined): boolean {
  return (version ?? 0) >= ANALYSIS_SCHEMA_VERSION
}
