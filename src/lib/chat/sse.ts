// The one line of Server-Sent Events framing both chat routes need.
//
// Extracted only because two routes now write it; it is deliberately nothing
// more than the wire format, so neither route's behaviour hides in here.
export function sseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}
