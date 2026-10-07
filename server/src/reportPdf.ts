import { PDFDocument, PDFFont, PDFPage, rgb, StandardFonts } from 'pdf-lib';
import { money, pdfSafe } from './invoice.js';
import { categoryLabels, Report } from './reports.js';

type Color = ReturnType<typeof rgb>;
const hex = (value: string) => rgb(parseInt(value.slice(1, 3), 16) / 255, parseInt(value.slice(3, 5), 16) / 255, parseInt(value.slice(5, 7), 16) / 255);
const gold = hex('#C4963C');
const goldDark = hex('#8B6B14');
const charcoal = hex('#1A1814');
const warmGrey = hex('#6B6560');
const rule = hex('#E8DDD0');
const goldPale = hex('#F5ECD8');
const white = rgb(1, 1, 1);
const width = 595.28;
const height = 841.89;
const margin = 52;

const longDate = (iso: string) => {
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
};
const percent = (part: number, whole: number) => whole ? `${Math.round((part / whole) * 100)}%` : '-';

/** Accounting-friendly revenue summary for a date range. */
export async function buildReportPdf(report: Report, logoPng?: Uint8Array): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Revenue report ${report.from} to ${report.to}`);
  pdf.setAuthor('Mandarin Orchid Resort');
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const serif = await pdf.embedFont(StandardFonts.TimesRomanBold);
  let logo = null as Awaited<ReturnType<typeof pdf.embedPng>> | null;
  if (logoPng) {
    try { logo = await pdf.embedPng(logoPng); } catch { logo = null; }
  }

  let page: PDFPage = pdf.addPage([width, height]);
  let y = 0;

  const text = (value: string, x: number, top: number, font: PDFFont, size: number, color: Color = charcoal, boxWidth?: number, align: 'left' | 'right' = 'left') => {
    const content = pdfSafe(value);
    const textWidth = font.widthOfTextAtSize(content, size);
    page.drawText(content, { x: boxWidth && align === 'right' ? x + boxWidth - textWidth : x, y: height - top - size * 0.8, size, font, color });
  };
  const fit = (value: string, font: PDFFont, size: number, maxWidth: number) => {
    let content = pdfSafe(value);
    while (content.length > 1 && font.widthOfTextAtSize(content, size) > maxWidth) content = `${content.slice(0, -2)}.`;
    return content;
  };
  const hr = (top: number, color: Color = rule, thickness = 0.5) =>
    page.drawLine({ start: { x: margin, y: height - top }, end: { x: width - margin, y: height - top }, color, thickness });
  const newPage = () => {
    page = pdf.addPage([width, height]);
    page.drawRectangle({ x: 0, y: height - 6, width, height: 6, color: gold });
    text(`Revenue report · ${longDate(report.from)} - ${longDate(report.to)}`, margin, 28, regular, 8, warmGrey);
    y = 56;
  };
  const ensure = (space: number) => { if (y + space > height - 70) newPage(); };
  const heading = (title: string) => {
    ensure(70);
    text(title.toUpperCase(), margin, y, bold, 8.5, goldDark);
    y += 16;
    hr(y, gold, 0.75);
    y += 10;
  };
  /** Simple table: columns are [label, width, align]; rows are strings. */
  const table = (columns: [string, number, 'left' | 'right'][], rows: string[][], options: { boldLast?: boolean } = {}) => {
    const header = () => {
      page.drawRectangle({ x: margin, y: height - y - 20, width: width - margin * 2, height: 20, color: charcoal });
      let x = margin + 8;
      for (const [label, columnWidth, align] of columns) {
        text(label.toUpperCase(), x, y + 6.5, bold, 7, white, columnWidth - 8, align);
        x += columnWidth;
      }
      y += 26;
    };
    header();
    rows.forEach((row, index) => {
      if (y + 18 > height - 70) {
        newPage();
        header();
      }
      const isTotal = options.boldLast && index === rows.length - 1;
      if (isTotal) page.drawRectangle({ x: margin, y: height - y - 13, width: width - margin * 2, height: 18, color: goldPale });
      let x = margin + 8;
      row.forEach((cell, cellIndex) => {
        const [, columnWidth, align] = columns[cellIndex];
        text(fit(cell, isTotal ? bold : regular, 8.5, columnWidth - 10), x, y, isTotal ? bold : regular, 8.5, charcoal, columnWidth - 8, align);
        x += columnWidth;
      });
      y += 13;
      if (!isTotal) hr(y - 2);
      y += 5;
    });
    y += 14;
  };

  // Header
  page.drawRectangle({ x: 0, y: height - 9, width, height: 9, color: gold });
  if (logo) {
    const scale = Math.min(110 / logo.width, 64 / logo.height);
    page.drawImage(logo, { x: margin, y: height - 30 - logo.height * scale, width: logo.width * scale, height: logo.height * scale });
  }
  text('REVENUE REPORT', 300, 44, serif, 22, charcoal, 243, 'right');
  text(`${longDate(report.from)} - ${longDate(report.to)}`, 300, 72, regular, 9, warmGrey, 243, 'right');
  text(`Generated ${longDate(new Date().toISOString().slice(0, 10))}`, 300, 86, regular, 8, warmGrey, 243, 'right');
  hr(116, gold, 1);
  y = 132;

  // Headline figures
  const figures: [string, string][] = [
    ['Revenue', money(report.totals.revenue)],
    ['Invoices', String(report.totals.invoices)],
    ['Average bill', money(report.totals.average)],
    ['Tax collected', money(report.totals.tax)],
  ];
  const boxWidth = (width - margin * 2 - 30) / 4;
  figures.forEach(([label, value], index) => {
    const x = margin + index * (boxWidth + 10);
    page.drawRectangle({ x, y: height - y - 52, width: boxWidth, height: 52, color: goldPale });
    text(label.toUpperCase(), x + 10, y + 10, bold, 7, goldDark);
    text(fit(value, serif, 14, boxWidth - 20), x + 10, y + 26, serif, 14);
  });
  y += 76;

  heading('Revenue by source');
  const sources = (['food', 'room', 'extras', 'tax', 'unitemised'] as const)
    .map(key => [categoryLabels[key], report.totals[key]] as const)
    .filter(([, amount]) => amount > 0);
  table([['Source', 260, 'left'], ['Share', 100, 'right'], ['Amount', 131, 'right']], [
    ...sources.map(([label, amount]) => [label, percent(amount, report.totals.revenue), money(amount)]),
    ['Total', '100%', money(report.totals.revenue)],
  ], { boldLast: true });
  if (report.totals.unitemisedInvoices) {
    text(`${report.totals.unitemisedInvoices} invoice(s) were created before itemised records and are shown as "Not itemised".`, margin, y - 8, regular, 7.5, warmGrey);
    y += 10;
  }

  if (report.byStay.length) {
    heading('Revenue by villa / room');
    table([['Villa / room', 260, 'left'], ['Invoices', 100, 'right'], ['Revenue', 131, 'right']],
      report.byStay.map(stay => [stay.label, String(stay.count), money(stay.total)]));
  }

  heading(report.granularity === 'day' ? 'Daily revenue' : 'Monthly revenue');
  const activeTrend = report.trend.filter(entry => entry.count > 0);
  table([['Period', 260, 'left'], ['Invoices', 100, 'right'], ['Revenue', 131, 'right']],
    activeTrend.length ? activeTrend.map(entry => [entry.label, String(entry.count), money(entry.total)]) : [['No invoices in this period', '', '']]);

  if (report.topItems.length) {
    heading('Best-selling food & beverages');
    table([['Item', 260, 'left'], ['Quantity', 100, 'right'], ['Revenue', 131, 'right']],
      report.topItems.map(item => [item.name, String(item.quantity), money(item.revenue)]));
  }

  heading('Invoice register');
  table([['Date', 62, 'left'], ['Invoice', 128, 'left'], ['Guest', 120, 'left'], ['Villa', 72, 'left'], ['Tax', 50, 'right'], ['Total', 59, 'right']], [
    ...report.register.slice().reverse().map(row => [longDate(row.date), row.invoice_number, row.guest_name, row.stay_label || '-', row.tax === null ? '-' : money(row.tax).replace('Rs. ', ''), money(row.total).replace('Rs. ', '')]),
    ['', '', '', '', 'Total', money(report.totals.revenue).replace('Rs. ', '')],
  ], { boldLast: true });

  // Footer on every page
  const pages = pdf.getPages();
  pages.forEach((current, index) => {
    current.drawLine({ start: { x: margin, y: 50 }, end: { x: width - margin, y: 50 }, color: gold, thickness: 0.5 });
    const label = pdfSafe(`Mandarin Orchid Resort · Page ${index + 1} of ${pages.length}`);
    current.drawText(label, { x: (width - regular.widthOfTextAtSize(label, 7.5)) / 2, y: 36, size: 7.5, font: regular, color: warmGrey });
  });

  return pdf.save();
}
