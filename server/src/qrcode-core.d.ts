// The QR library's pure-JavaScript core (no Node APIs), so it runs on Cloudflare Workers.
declare module 'qrcode/lib/core/qrcode.js' {
  export function create(text: string, options?: { errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H' }): {
    modules: { size: number; get(row: number, column: number): number | boolean };
  };
}
