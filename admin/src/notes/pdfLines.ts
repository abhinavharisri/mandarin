import type { TextItem } from 'pdfjs-dist/types/src/display/api';

type PdfJs = typeof import('pdfjs-dist');

/**
 * Rebuilds visual lines from a PDF's text layer: items are grouped by their baseline
 * and joined left to right, with a space wherever there is a visible gap.
 */
export async function pdfTextLines(data: Uint8Array, pdfjs: PdfJs): Promise<string[]> {
  const task = pdfjs.getDocument({ data, disableFontFace: true, useSystemFonts: false });
  const document = await task.promise;
  const lines: string[] = [];
  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const items = content.items.filter((item): item is TextItem => 'str' in item && item.str.trim() !== '');
      const rows: { y: number; height: number; items: TextItem[] }[] = [];
      for (const item of items) {
        const y = item.transform[5];
        const height = Math.abs(item.height || item.transform[3] || 10);
        const row = rows.find(candidate => Math.abs(candidate.y - y) < Math.max(2, Math.min(height, candidate.height) * 0.5));
        if (row) row.items.push(item);
        else rows.push({ y, height, items: [item] });
      }
      rows.sort((a, b) => b.y - a.y);
      for (const row of rows) {
        row.items.sort((a, b) => a.transform[4] - b.transform[4]);
        let text = '';
        let previousEnd: number | null = null;
        for (const item of row.items) {
          const x = item.transform[4];
          if (previousEnd !== null && x - previousEnd > row.height * 0.15 && !text.endsWith(' ')) text += ' ';
          text += item.str;
          previousEnd = x + item.width;
        }
        const clean = text.replace(/\s+/g, ' ').trim();
        if (clean) lines.push(clean);
      }
      page.cleanup();
    }
  } finally {
    await task.destroy();
  }
  return lines;
}
