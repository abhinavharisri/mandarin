import PDFDocument from 'pdfkit';
import fs from 'node:fs';
import path from 'node:path';

export type InvoiceLine = { description: string; quantity: number; unitPrice: number };
export type InvoiceData = {
  invoiceNumber: string;
  issueDate: Date;
  guestName: string;
  guestEmail?: string;
  stayStart: Date;
  stayEnd: Date;
  taxRate: number;
  lineItems: InvoiceLine[];
};

export function calculateTotals(items: InvoiceLine[], taxRate: number) {
  const subtotal = items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
  const taxAmount = Math.round(subtotal * taxRate) / 100;
  return { subtotal: Math.round(subtotal * 100) / 100, taxAmount, total: Math.round((subtotal + taxAmount) * 100) / 100 };
}

export function buildInvoicePdf(data: InvoiceData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const document = new PDFDocument({ size: 'A4', margin: 52, bufferPages: true });
    const chunks: Buffer[] = [];
    document.on('data', chunk => chunks.push(Buffer.from(chunk)));
    document.on('error', reject);
    document.on('end', () => resolve(Buffer.concat(chunks)));

    const gold = '#C4963C';
    const charcoal = '#1A1814';
    const warmGrey = '#6B6560';
    const totals = calculateTotals(data.lineItems, data.taxRate);
    const logoPath = process.env.LOGO_PATH || path.resolve(process.cwd(), 'images/logo.png');

    document.rect(0, 0, document.page.width, 9).fill(gold);
    if (fs.existsSync(logoPath)) document.image(logoPath, 52, 34, { fit: [118, 70] });
    document.fillColor(charcoal).font('Times-Bold').fontSize(28).text('INVOICE', 340, 48, { align: 'right' });
    document.fillColor(warmGrey).font('Helvetica').fontSize(9).text('MANDARIN ORCHID RESORT', 340, 82, { align: 'right' });

    document.moveTo(52, 128).lineTo(543, 128).strokeColor(gold).lineWidth(1).stroke();
    document.fillColor(gold).font('Helvetica-Bold').fontSize(8).text('INVOICE DETAILS', 52, 148, { characterSpacing: 1.5 });
    document.fillColor(charcoal).font('Helvetica').fontSize(10)
      .text(`Invoice number  ${data.invoiceNumber}`, 52, 168)
      .text(`Issue date  ${data.issueDate.toLocaleDateString('en-IN')}`, 52, 184);
    document.fillColor(gold).font('Helvetica-Bold').fontSize(8).text('BILLED TO', 310, 148, { characterSpacing: 1.5 });
    document.fillColor(charcoal).font('Helvetica').fontSize(10).text(data.guestName, 310, 168);
    if (data.guestEmail) document.fillColor(warmGrey).fontSize(9).text(data.guestEmail, 310, 184);
    document.fillColor(warmGrey).fontSize(9)
      .text(`Stay: ${data.stayStart.toLocaleDateString('en-IN')} – ${data.stayEnd.toLocaleDateString('en-IN')}`, 52, 224);

    const tableTop = 264;
    document.rect(52, tableTop, 491, 28).fill(charcoal);
    document.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(8)
      .text('DESCRIPTION', 64, tableTop + 10)
      .text('QTY', 350, tableTop + 10, { width: 40, align: 'right' })
      .text('RATE', 410, tableTop + 10, { width: 60, align: 'right' })
      .text('AMOUNT', 477, tableTop + 10, { width: 54, align: 'right' });
    let rowY = tableTop + 38;
    for (const item of data.lineItems) {
      if (rowY > 620) {
        document.addPage();
        rowY = 70;
      }
      document.fillColor(charcoal).font('Helvetica').fontSize(9).text(item.description, 64, rowY, { width: 265 });
      document.text(String(item.quantity), 350, rowY, { width: 40, align: 'right' });
      document.text(formatMoney(item.unitPrice), 410, rowY, { width: 60, align: 'right' });
      document.text(formatMoney(item.quantity * item.unitPrice), 477, rowY, { width: 54, align: 'right' });
      rowY += 28;
      document.moveTo(52, rowY - 8).lineTo(543, rowY - 8).strokeColor('#E8DDD0').lineWidth(0.5).stroke();
    }

    const totalsY = Math.max(rowY + 12, 380);
    document.fillColor(warmGrey).font('Helvetica').fontSize(9).text('Subtotal', 350, totalsY, { width: 110 });
    document.fillColor(charcoal).text(formatMoney(totals.subtotal), 465, totalsY, { width: 66, align: 'right' });
    document.fillColor(warmGrey).text(`Tax (${data.taxRate.toFixed(2)}%)`, 350, totalsY + 22, { width: 110 });
    document.fillColor(charcoal).text(formatMoney(totals.taxAmount), 465, totalsY + 22, { width: 66, align: 'right' });
    document.rect(342, totalsY + 48, 201, 34).fill('#F5ECD8');
    document.fillColor(charcoal).font('Helvetica-Bold').fontSize(10).text('TOTAL (INR)', 354, totalsY + 60);
    document.fillColor(charcoal).text(formatMoney(totals.total), 465, totalsY + 60, { width: 66, align: 'right' });

    document.moveTo(52, 752).lineTo(543, 752).strokeColor(gold).lineWidth(0.75).stroke();
    document.fillColor(warmGrey).font('Helvetica').fontSize(8)
      .text('Thank you for choosing Mandarin Orchid Resort.', 52, 767, { align: 'center', width: 491 });
    document.end();
  });
}

function formatMoney(amount: number) {
  return `₹ ${amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
