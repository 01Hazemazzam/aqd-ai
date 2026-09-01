# Chat transport is an async generator, even for the one-shot product helper

The Chat widget is shared by two surfaces with different transports: Contract chat streams tokens over SSE, the Product helper returns one atomic answer from a server action. To keep the widget a single deep module that owns the whole message lifecycle (append, grow, finalize, error, cancel-on-unmount) rather than branching on transport kind, both surfaces inject the same interface: `send(question, { signal }) => AsyncIterable<Delta>`. The Product helper's adapter is therefore a generator that yields exactly one `finalize` delta — its "streaming" is a stream of length one.

## Consequences

Wrapping a one-shot server action in an async generator looks like over-engineering in isolation. It is deliberate: it lets the widget's consume loop be a single `for await` with no per-transport special-casing, so all lifecycle correctness lives in one place instead of being reimplemented per caller. Do not "simplify" the Product helper adapter back into a direct call — that reintroduces the transport branch the generator exists to remove.
