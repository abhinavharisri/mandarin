import { NotesImport, parseNotes } from './parseNotes';
import { pdfTextLines } from './pdfLines';

/** Reads a staff notes export (PDF or plain text) and parses it into invoice lines. */
export async function readNotesFile(file: File): Promise<NotesImport> {
  let lines: string[];
  if (file.type === 'text/plain' || /\.txt$/i.test(file.name)) {
    lines = (await file.text()).split(/\r?\n/);
  } else {
    // pdf.js is large, so it is only downloaded when someone imports a PDF.
    const [pdfjs, worker] = await Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]);
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
    try {
      lines = await pdfTextLines(new Uint8Array(await file.arrayBuffer()), pdfjs);
    } catch {
      throw new Error('This file could not be opened as a PDF. Export the note again and retry.');
    }
  }
  if (!lines.some(line => line.trim())) {
    throw new Error('No text was found in this PDF. It may be a photo or scan, so please enter the items manually.');
  }
  const result = parseNotes(lines);
  if (!result.lines.length) {
    throw new Error('No bill items with amounts were found. Each item should look like "Idly 30 - 750".');
  }
  return result;
}
