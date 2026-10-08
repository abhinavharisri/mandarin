import { create } from 'qrcode/lib/core/qrcode.js';

/** A QR code as a square grid of dark/light modules, for drawing as vector shapes. */
export function qrMatrix(text: string) {
  const { modules } = create(text, { errorCorrectionLevel: 'M' });
  return { size: modules.size, isDark: (row: number, column: number) => Boolean(modules.get(row, column)) };
}
