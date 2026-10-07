import { PDFDocument, PDFFont, PDFPage, rgb, StandardFonts } from 'pdf-lib';

export type InvoiceLine = { description: string; quantity: number; unitPrice: number; section?: string; itemId?: string };
export type InvoiceData = {
  invoiceNumber: string;
  issueDate: Date;
  /** Set when an issued invoice is edited; shown as "Revised" on the PDF. */
  revisedAt?: Date;
  guestName: string;
  guestEmail?: string;
  stayStart: Date;
  stayEnd: Date;
  /** Optional room or villa name, e.g. "Villa 1". */
  stayLabel?: string;
  taxRate: number;
  /** Advance already received; the PDF then shows the balance payable. */
  advancePaid?: number;
  lineItems: InvoiceLine[];
  /** PNG bytes for the resort logo; the header is drawn without it when absent. */
  logoPng?: Uint8Array;
};

export function calculateTotals(items: InvoiceLine[], taxRate: number) {
  const subtotal = items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
  const taxAmount = Math.round(subtotal * taxRate) / 100;
  return { subtotal: Math.round(subtotal * 100) / 100, taxAmount, total: Math.round((subtotal + taxAmount) * 100) / 100 };
}

const hex = (value: string) => rgb(parseInt(value.slice(1, 3), 16) / 255, parseInt(value.slice(3, 5), 16) / 255, parseInt(value.slice(5, 7), 16) / 255);
const gold = hex('#C4963C');
const charcoal = hex('#1A1814');
const warmGrey = hex('#6B6560');
const rule = hex('#E8DDD0');
const goldPale = hex('#F5ECD8');
const white = rgb(1, 1, 1);

// The built-in PDF fonts only cover Western (WinAnsi) characters. Map common
// punctuation and replace anything else so unusual names never break generation.
const replacements: Record<string, string> = { '‘': "'", '’': "'", '“': '"', '”': '"', '–': '-', '—': '-', '…': '...', '₹': 'Rs.' };
export function pdfSafe(text: string) {
  return [...text.normalize('NFC')].map(character => {
    if (replacements[character]) return replacements[character];
    const code = character.codePointAt(0)!;
    if ((code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff)) return character;
    const stripped = character.normalize('NFD').replace(/[̀-ͯ]/g, '');
    return /^[\x20-\x7e]$/.test(stripped) ? stripped : '?';
  }).join('');
}

export const money = (amount: number) => `Rs. ${amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** Unambiguous dates such as "2 Oct 2026" (numeric dates read differently in India and the US). */
export function date(value: Date) {
  const [year, month, day] = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(value).split('-').map(Number);
  return `${day} ${monthNames[month - 1]} ${year}`;
}

/** 1.5 → "1½", 0.5 → "½". */
export const quantityText = (quantity: number) =>
  Number.isInteger(quantity) ? String(quantity) : `${Math.floor(quantity) || ''}½`;

type TextOptions = { font: PDFFont; size: number; color?: ReturnType<typeof rgb>; width?: number; align?: 'left' | 'right' | 'center'; spacing?: number };

export async function buildInvoicePdf(data: InvoiceData): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Invoice ${data.invoiceNumber}`);
  pdf.setAuthor('Mandarin Orchid Resort');
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const serif = await pdf.embedFont(StandardFonts.TimesRomanBold);
  const totals = calculateTotals(data.lineItems, data.taxRate);

  let page = pdf.addPage([595.28, 841.89]);
  const height = page.getHeight();

  /** Draws text using top-left coordinates, like the original layout. */
  const text = (target: PDFPage, value: string, x: number, top: number, options: TextOptions) => {
    const content = pdfSafe(value);
    const spacing = options.spacing ?? 0;
    const width = options.font.widthOfTextAtSize(content, options.size) + spacing * Math.max(0, content.length - 1);
    const offset = options.width && options.align === 'right' ? options.width - width
      : options.width && options.align === 'center' ? (options.width - width) / 2 : 0;
    target.drawText(content, {
      x: x + offset, y: height - top - options.size * 0.8, size: options.size, font: options.font,
      color: options.color ?? charcoal, characterSpacing: spacing || undefined,
    } as Parameters<PDFPage['drawText']>[1]);
  };
  const line = (target: PDFPage, x1: number, top: number, x2: number, color: ReturnType<typeof rgb>, thickness: number) =>
    target.drawLine({ start: { x: x1, y: height - top }, end: { x: x2, y: height - top }, color, thickness });
  const box = (target: PDFPage, x: number, top: number, width: number, boxHeight: number, color: ReturnType<typeof rgb>) =>
    target.drawRectangle({ x, y: height - top - boxHeight, width, height: boxHeight, color });
  const wrap = (value: string, font: PDFFont, size: number, maxWidth: number) => {
    const lines: string[] = [];
    let current = '';
    for (const word of pdfSafe(value).split(/\s+/)) {
      const candidate = current ? `${current} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth || !current) current = candidate;
      else {
        lines.push(current);
        current = word;
      }
    }
    if (current) lines.push(current);
    return lines;
  };

  box(page, 0, 0, page.getWidth(), 9, gold);
  if (data.logoPng) {
    try {
      const logo = await pdf.embedPng(data.logoPng);
      const scale = Math.min(118 / logo.width, 70 / logo.height);
      page.drawImage(logo, { x: 52, y: height - 34 - logo.height * scale, width: logo.width * scale, height: logo.height * scale });
    } catch { /* invoice remains valid without the logo */ }
  }
  text(page, 'INVOICE', 340, 48, { font: serif, size: 28, width: 203, align: 'right' });
  text(page, 'MANDARIN ORCHID RESORT', 340, 82, { font: regular, size: 9, color: warmGrey, width: 203, align: 'right' });
  if (data.revisedAt) text(page, `REVISED ${date(data.revisedAt).toUpperCase()}`, 340, 98, { font: bold, size: 7.5, color: gold, width: 203, align: 'right', spacing: 1 });

  line(page, 52, 128, 543, gold, 1);
  text(page, 'INVOICE DETAILS', 52, 148, { font: bold, size: 8, color: gold, spacing: 1.5 });
  text(page, `Invoice number  ${data.invoiceNumber}`, 52, 168, { font: regular, size: 10 });
  text(page, `Issue date  ${date(data.issueDate)}`, 52, 184, { font: regular, size: 10 });
  text(page, 'BILLED TO', 310, 148, { font: bold, size: 8, color: gold, spacing: 1.5 });
  text(page, data.guestName, 310, 168, { font: regular, size: 10 });
  if (data.guestEmail) text(page, data.guestEmail, 310, 184, { font: regular, size: 9, color: warmGrey });
  const nights = Math.max(0, Math.round((data.stayEnd.getTime() - data.stayStart.getTime()) / 86_400_000));
  const stay = [data.stayLabel, `Stay: ${date(data.stayStart)} - ${date(data.stayEnd)}`, `${nights} night${nights === 1 ? '' : 's'}`].filter(Boolean).join('   ·   ');
  text(page, stay, 52, 224, { font: regular, size: 9, color: warmGrey });

  const tableHeader = (target: PDFPage, top: number) => {
    box(target, 52, top, 491, 28, charcoal);
    text(target, 'DESCRIPTION', 64, top + 10, { font: bold, size: 8, color: white });
    text(target, 'QTY', 350, top + 10, { font: bold, size: 8, color: white, width: 40, align: 'right' });
    text(target, 'RATE', 395, top + 10, { font: bold, size: 8, color: white, width: 70, align: 'right' });
    text(target, 'AMOUNT', 465, top + 10, { font: bold, size: 8, color: white, width: 66, align: 'right' });
  };
  tableHeader(page, 264);
  let rowY = 302;
  const newPageIfNeeded = (needed: number) => {
    if (rowY + needed <= 700) return;
    page = pdf.addPage([595.28, 841.89]);
    tableHeader(page, 52);
    rowY = 90;
  };
  let currentSection: string | undefined;
  data.lineItems.forEach((item, index) => {
    const section = item.section?.trim() || undefined;
    if (section && section !== currentSection) {
      // Section heading with its subtotal, e.g. "2 OCT · BREAKFAST ............ Rs. 2,270.00"
      let sectionTotal = 0;
      for (let next = index; next < data.lineItems.length && (data.lineItems[next].section?.trim() || undefined) === section; next++) {
        sectionTotal += data.lineItems[next].quantity * data.lineItems[next].unitPrice;
      }
      newPageIfNeeded(50);
      box(page, 52, rowY - 6, 491, 22, goldPale);
      text(page, section.toUpperCase(), 64, rowY, { font: bold, size: 8, color: hex('#8B6B14'), spacing: 1.2 });
      text(page, money(sectionTotal), 440, rowY, { font: bold, size: 8, color: hex('#8B6B14'), width: 91, align: 'right' });
      rowY += 26;
    }
    currentSection = section;
    const descriptionLines = wrap(item.description, regular, 9, 270);
    const rowHeight = Math.max(22, descriptionLines.length * 12 + 10);
    newPageIfNeeded(rowHeight);
    descriptionLines.forEach((descriptionLine, lineIndex) => text(page, descriptionLine, 64, rowY + lineIndex * 12, { font: regular, size: 9 }));
    text(page, quantityText(item.quantity), 350, rowY, { font: regular, size: 9, width: 40, align: 'right' });
    text(page, money(item.unitPrice), 395, rowY, { font: regular, size: 9, width: 70, align: 'right' });
    text(page, money(item.quantity * item.unitPrice), 465, rowY, { font: regular, size: 9, width: 66, align: 'right' });
    rowY += rowHeight;
    line(page, 52, rowY - 7, 543, rule, 0.5);
  });

  const advance = data.advancePaid && data.advancePaid > 0 ? Math.min(data.advancePaid, totals.total) : 0;
  if (rowY + (advance ? 170 : 110) > 740) {
    page = pdf.addPage([595.28, 841.89]);
    rowY = 60;
  }
  const totalsY = Math.max(rowY + 12, 380);
  text(page, 'Subtotal', 350, totalsY, { font: regular, size: 9, color: warmGrey });
  text(page, money(totals.subtotal), 440, totalsY, { font: regular, size: 9, width: 91, align: 'right' });
  text(page, `Tax (${data.taxRate.toFixed(2)}%)`, 350, totalsY + 22, { font: regular, size: 9, color: warmGrey });
  text(page, money(totals.taxAmount), 440, totalsY + 22, { font: regular, size: 9, width: 91, align: 'right' });
  box(page, 342, totalsY + 48, 201, 34, goldPale);
  text(page, 'TOTAL (INR)', 354, totalsY + 60, { font: bold, size: 10 });
  text(page, money(totals.total), 430, totalsY + 60, { font: bold, size: 10, width: 101, align: 'right' });
  if (advance) {
    text(page, 'Advance paid', 350, totalsY + 96, { font: regular, size: 9, color: warmGrey });
    text(page, `- ${money(advance)}`, 430, totalsY + 96, { font: regular, size: 9, width: 101, align: 'right' });
    box(page, 342, totalsY + 116, 201, 34, charcoal);
    text(page, 'BALANCE PAYABLE', 354, totalsY + 128, { font: bold, size: 10, color: white });
    text(page, money(Math.round((totals.total - advance) * 100) / 100), 430, totalsY + 128, { font: bold, size: 10, color: white, width: 101, align: 'right' });
  }

  line(page, 52, 752, 543, gold, 0.75);
  text(page, 'Thank you for choosing Mandarin Orchid Resort.', 52, 767, { font: regular, size: 8, color: warmGrey, width: 491, align: 'center' });

  return pdf.save();
}
