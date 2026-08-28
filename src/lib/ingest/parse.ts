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

async function parsePdf(bytes: Uint8Array): Promise<string> {
  const pdf = await getDocumentProxy(bytes)
  const { text } = await extractText(pdf, { mergePages: true })
  return text
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
