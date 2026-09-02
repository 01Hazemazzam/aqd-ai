// Reading a Server-Sent Events response on the client.
//
// Extracted when the second chat surface appeared: frame splitting is fiddly
// enough (a chunk boundary can land mid-frame, so the trailing partial has to
// survive to the next read) that having two copies of it is two places for
// the same subtle bug to live.

export interface SseFrame {
  event: string
  data: Record<string, unknown>
}

export async function* readSseFrames(response: Response): AsyncIterable<SseFrame> {
  if (!response.body) throw new Error('no response body')

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    const frames = buffer.split('\n\n')
    // The last element is whatever came after the final blank line -- an
    // incomplete frame -- so it goes back on the buffer rather than being
    // parsed as if it were whole.
    buffer = frames.pop() ?? ''

    for (const frame of frames) {
      const lines = frame.split('\n')
      const eventLine = lines.find((l) => l.startsWith('event:'))
      const dataLine = lines.find((l) => l.startsWith('data:'))
      if (!eventLine || !dataLine) continue
      yield { event: eventLine.slice(6).trim(), data: JSON.parse(dataLine.slice(5).trim()) }
    }
  }
}
