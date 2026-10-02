import { extractText, getDocumentProxy } from 'unpdf';

/** Text of a PDF (official reports, statements). Text PDFs only: scanned pages come back empty. */
export async function pdfText(bytes: ArrayBuffer): Promise<string> {
  const pdf = await getDocumentProxy(new Uint8Array(bytes), { verbosity: 0 });
  const { text } = await extractText(pdf, { mergePages: false });
  return (text as string[]).join('\n');
}
