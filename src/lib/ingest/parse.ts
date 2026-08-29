import { extractText, getDocumentProxy } from 'unpdf'
import { extractRawText } from 'mammoth'

export type SupportedMimeType =
  | 'application/pdf'
  | 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

export class UnsupportedFileTypeError extends Error {
  constructor(mimeType: string) {
    super(`Unsupported file type: ${mimeType}`)
    this.name = 'UnsupportedFileTypeError'
  }
}

export class EmptyDocumentError extends Error {
  constructor() {
    super('The document contains no extractable text')
    this.name = 'EmptyDocumentError'
  }
}

const EDGE_LINE_WINDOW = 2 // a running header/footer structurally sits at the very top or bottom of a page

function normalizeForRepeatDetection(line: string): string {
  return line.trim().replace(/\d+/g, '#')
}

// unpdf's merged text has no page-boundary markers, so a running header or
// footer (only the page number varies) gets interleaved straight into
// whatever clause happens to be open at that page break -- confirmed on a
// real user-reported PDF: "...until service is restored.\nAqd AI synthetic
// QA contract - testing only Page 2\nFor Severity 2 incidents..." landed
// mid-clause. Detected structurally (near the top/bottom of a page,
// identical apart from a page number, present on nearly every page) rather
// than by matching that specific text, so this holds for any document's own
// header/footer, not just one fixture's.
function stripRunningHeadersFooters(pages: string[]): string[] {
  if (pages.length < 3) return pages // too few pages to tell a repeat from a coincidence

  const perPageLines = pages.map((page) => page.split('\n'))
  const edgeLines = (lines: string[]) => {
    const nonEmpty = lines.filter((l) => l.trim().length > 0)
    return [...nonEmpty.slice(0, EDGE_LINE_WINDOW), ...nonEmpty.slice(-EDGE_LINE_WINDOW)]
  }

  const pagesByNormalizedLine = new Map<string, Set<number>>()
  perPageLines.forEach((lines, pageIndex) => {
    for (const normalized of new Set(edgeLines(lines).map(normalizeForRepeatDetection))) {
      if (!pagesByNormalizedLine.has(normalized)) pagesByNormalizedLine.set(normalized, new Set())
      pagesByNormalizedLine.get(normalized)!.add(pageIndex)
    }
  })

  const threshold = pages.length - 1 // present on all pages but at most one
  const runningLines = new Set(
    [...pagesByNormalizedLine].filter(([, pageSet]) => pageSet.size >= threshold).map(([normalized]) => normalized),
  )

  return perPageLines.map((lines) =>
    lines.filter((line) => !runningLines.has(normalizeForRepeatDetection(line))).join('\n'),
  )
}

async function parsePdf(bytes: Uint8Array): Promise<string> {
  const pdf = await getDocumentProxy(bytes)
  const { text: pages } = await extractText(pdf, { mergePages: false })
  return stripRunningHeadersFooters(pages).join('\n')
}

async function parseDocx(bytes: Uint8Array): Promise<string> {
  const { value } = await extractRawText({ buffer: Buffer.from(bytes) })
  return value
}

export async function parseDocument(bytes: Uint8Array, mimeType: string): Promise<string> {
  const text =
    mimeType === 'application/pdf' ? await parsePdf(bytes)
    : mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ? await parseDocx(bytes)
    : (() => { throw new UnsupportedFileTypeError(mimeType) })()

  if (text.trim().length === 0) throw new EmptyDocumentError()
  return text
}
