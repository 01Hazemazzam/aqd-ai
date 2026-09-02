// The largest document the app accepts, in one place because two sides need
// the same number: the server action that enforces it, and the two upload
// buttons that have to tell a person what the limit is before they wait for a
// rejection.
//
// It was 50 MB, chosen against Supabase Storage's own per-file cap. The
// binding constraint is not storage, it is time: a document that large cannot
// finish parse, segmentation, embedding and five AI tasks inside a single
// serverless invocation's 60-second ceiling, so a 50 MB upload does not fail
// at the limit -- it fails at the wall clock, after the user has waited a
// minute, with a killed function and a half-written contract.
//
// NEXT_PUBLIC_ because the browser reads it too. That is not a secret being
// exposed; it is a published limit, and it is inlined at build time, so
// changing it means a redeploy rather than a live edit. The server check is
// still the enforcing one -- the client value only decides what the message
// says.
export const MAX_UPLOAD_MB = Number(process.env.NEXT_PUBLIC_MAX_UPLOAD_MB ?? 10)

export const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024
