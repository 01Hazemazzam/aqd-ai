// tests/components/chat-widget.test.tsx
//
// The whole point of the async-generator transport seam (ADR-0001) is that a
// fake transport is trivial to inject, so the shared chat chrome -- previously
// welded to a live fetch / server action in two separate components and thus
// untestable in practice -- is now exercised through one interface. These
// assert observable rendered output, never internal state, so they survive an
// implementation rewrite.
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ChatWidget, type Delta } from '@/components/chat-widget'

const STRINGS = {
  emptyText: 'No messages yet',
  placeholder: 'Ask a question',
  sendLabel: 'Send',
  errorText: (key: string) => `ERR:${key}`,
}

// Turns a fixed list of deltas into the AsyncIterable the widget consumes.
function fakeTransport<Extra = unknown>(deltas: Delta<Extra>[]) {
  return async function* () {
    for (const d of deltas) yield d
  }
}

async function ask(question: string) {
  fireEvent.change(screen.getByPlaceholderText(STRINGS.placeholder), { target: { value: question } })
  fireEvent.click(screen.getByRole('button', { name: STRINGS.sendLabel }))
}

describe('ChatWidget', () => {
  it('renders the empty state before any message is sent', () => {
    render(<ChatWidget send={fakeTransport([])} {...STRINGS} />)
    expect(screen.getByText('No messages yet')).toBeInTheDocument()
  })

  it('appends the user question and grows the assistant bubble from append deltas', async () => {
    const send = () => fakeTransport([
      { type: 'append', text: 'Hello' },
      { type: 'append', text: ' world' },
    ])()
    render(<ChatWidget send={send} {...STRINGS} />)

    await ask('What does clause 3 say?')

    expect(await screen.findByText('What does clause 3 say?')).toBeInTheDocument()
    // The two append deltas accumulate into one assistant bubble.
    expect(await screen.findByText('Hello world')).toBeInTheDocument()
  })

  it('passes finalize patch fields through to renderContent', async () => {
    const send = () => fakeTransport<{ tag?: string }>([
      { type: 'finalize', patch: { content: 'The answer', tag: 'CITED' } },
    ])()
    render(
      <ChatWidget<{ tag?: string }>
        send={send}
        renderContent={(m) => <span>{m.content}::{m.tag ?? 'none'}</span>}
        {...STRINGS}
      />,
    )

    await ask('anything')

    // renderContent received the extra `tag` field merged by the finalize delta.
    expect(await screen.findByText('The answer::CITED')).toBeInTheDocument()
  })

  it('renders an error delta as an alert via errorText', async () => {
    const send = () => fakeTransport([{ type: 'error', errorKey: 'quota_exceeded' }])()
    render(<ChatWidget send={send} {...STRINGS} />)

    await ask('anything')

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('ERR:quota_exceeded')
  })

  it('funnels a thrown transport error into the same error path', async () => {
    const send = () =>
      (async function* (): AsyncIterable<Delta> {
        throw new Error('network died')
      })()
    render(<ChatWidget send={send} {...STRINGS} />)

    await ask('anything')

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('ERR:unknown')
  })

  it('seeds from initialMessages so a reload shows prior history', () => {
    render(
      <ChatWidget
        send={fakeTransport([])}
        initialMessages={[
          { role: 'user', content: 'Earlier question' },
          { role: 'assistant', content: 'Earlier answer' },
        ]}
        {...STRINGS}
      />,
    )
    expect(screen.getByText('Earlier question')).toBeInTheDocument()
    expect(screen.getByText('Earlier answer')).toBeInTheDocument()
    expect(screen.queryByText('No messages yet')).not.toBeInTheDocument()
  })

  it('passes the AbortSignal to the transport', async () => {
    const seen: AbortSignal[] = []
    const send = (_q: string, { signal }: { signal: AbortSignal }) => {
      seen.push(signal)
      return fakeTransport([{ type: 'finalize', patch: { content: 'ok' } }])()
    }
    render(<ChatWidget send={send} {...STRINGS} />)

    await ask('anything')
    await screen.findByText('ok')

    expect(seen).toHaveLength(1)
    expect(seen[0]).toBeInstanceOf(AbortSignal)
  })
})
