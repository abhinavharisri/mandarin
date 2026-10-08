/**
 * Turns staff billing notes (as typed in a phone notes app) into invoice lines.
 *
 * Understands lines such as:
 *   Villa 1 · Check in 2/10 · Check out 4/10   → stay details
 *   2/10 · Breakfast · Dinner                  → day and meal sections
 *   Idly 30. -750 · Chicken gravy-9- 2500      → item, quantity and line amount
 *   Chicken 65 1½kg - 2850 · Campfire 2 days- 4000
 *   Total. - 21,825                            → cross-check against the computed total
 * Amounts in the notes are line totals; anything it cannot read is reported back.
 */

export type ImportedLine = {
  section: string;
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  /** The original line from the notes, for review. */
  source: string;
};

export type NotesImport = {
  stayLabel: string;
  /** ISO dates (yyyy-mm-dd) or '' when not found. */
  stayStart: string;
  stayEnd: string;
  lines: ImportedLine[];
  /** The last "Total" written in the notes, if any. */
  declaredTotal: number | null;
  /** Lines that looked meaningful but could not be read as an item. */
  skipped: string[];
};

const mealWords = /^(early\s+)?(breakfast|brunch|lunch|dinner|supper|snacks?|evening\s+snacks?|high\s+tea|beverages?|drinks?|bar|extras?|others?|misc(ellaneous)?|activities|food|room\s+service)$/i;
const roomLine = /^(villa|room|cottage|suite|block|unit|house|tent)\b[\s\w#-]{0,20}$/i;
const dateOnly = /^(\d{1,2})\s*[/.-]\s*(\d{1,2})(?:\s*[/.-]\s*(\d{2,4}))?$/;
const datePart = /(\d{1,2})\s*[/.-]\s*(\d{1,2})(?:\s*[/.-]\s*(\d{2,4}))?/;
const amount = String.raw`(\d[\d,]*(?:\.\d{1,2})?)`;
const dashAmount = new RegExp(String.raw`^(.*?)\s*[-–—=:]\s*(?:rs\.?|₹|inr)?\s*${amount}\s*(?:\/-?|-)?\s*$`, 'i');
const currencyAmount = new RegExp(String.raw`^(.*?)\s+(?:rs\.?|₹|inr)\s*${amount}\s*(?:\/-?)?\s*$`, 'i');
const quantityTail = /^(.*?)[\s.'’`,-]*?(\d+(?:\.\d+)?½?|½|¼|¾|\d+[¼¾])\s*(kgs?|g|gms?|grams?|plates?|pcs?|pieces?|nos?|days?|nights?|cups?|glasses?|bottles?|packets?|persons?|pax|x)?$/i;
const dishesWith65 = /\b(chicken|gobi|gopi|gobhi|paneer|panner|mushroom|fish|prawns?|egg|baby\s*corn|cauliflower|mutton)$/i;

// Common spellings in staff notes mapped to how they should read on a guest's bill.
const spellings: Record<string, string> = {
  panner: 'Paneer', paneer: 'Paneer', gopi: 'Gobi', gobi: 'Gobi', gobhi: 'Gobi',
  biriyani: 'Biryani', birayni: 'Biryani', briyani: 'Biryani', biryani: 'Biryani', biriani: 'Biryani',
  chapati: 'Chapati', chapathi: 'Chapati', chappathi: 'Chapati', chappati: 'Chapati',
  idly: 'Idli', idli: 'Idli', dosai: 'Dosa', dosa: 'Dosa', parota: 'Parotta', porotta: 'Parotta',
};

const money = (text: string) => Number(text.replace(/,/g, ''));

function tidyName(text: string) {
  return text
    .replace(/[\s.'’`,:;-]+$/, '')
    .replace(/^[\s.'’`,:;-]+/, '')
    .replace(/\s+/g, ' ')
    .split(' ')
    .map(word => spellings[word.toLowerCase()] || (/^[a-z]/i.test(word) ? word[0].toUpperCase() + word.slice(1).toLowerCase() : word))
    .join(' ');
}

function quantityValue(text: string) {
  const fractions: Record<string, number> = { '½': 0.5, '¼': 0.25, '¾': 0.75 };
  const match = text.match(/^(\d+(?:\.\d+)?)?([½¼¾])?$/);
  if (!match) return NaN;
  return (match[1] ? Number(match[1]) : 0) + (match[2] ? fractions[match[2]] : 0);
}

function isoDate(day: number, month: number, year: number | undefined, reference: Date) {
  const fullYear = year === undefined ? reference.getFullYear() : year < 100 ? 2000 + year : year;
  const date = new Date(Date.UTC(fullYear, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return '';
  return date.toISOString().slice(0, 10);
}

type DateOrder = 'dm' | 'md';
type DateParts = [first: number, second: number, year?: number];

/**
 * Staff may write 2 October as "2/10" (day first) or "10/2" (month first). Choose the
 * order that makes every date in the note valid and keeps them closest to today.
 */
function chooseDateOrder(dates: DateParts[], reference: Date): DateOrder {
  const score = (order: DateOrder) => dates.reduce((total, [first, second, year]) => {
    const iso = order === 'dm' ? isoDate(first, second, year, reference) : isoDate(second, first, year, reference);
    return total + (iso ? Math.abs(Date.parse(`${iso}T00:00:00Z`) - reference.getTime()) / 86_400_000 : 100_000);
  }, 0);
  return score('md') < score('dm') ? 'md' : 'dm';
}

const datePieces = (match: RegExpMatchArray): DateParts =>
  [Number(match[1]), Number(match[2]), match[3] ? Number(match[3]) : undefined];

/** Splits "Panner 65 3 plates" into name and quantity, keeping dish names like "Chicken 65" intact. */
function splitItem(left: string, lineAmount: number) {
  const cleaned = left.replace(/[\s.'’`,:;-]+$/, '').trim();
  const match = cleaned.match(quantityTail);
  let name = cleaned;
  let quantityText = '';
  let unit = '';
  if (match && /[a-z]/i.test(match[1])) {
    [, name, quantityText, unit = ''] = match;
    if (quantityText === '65' && !unit && dishesWith65.test(name.trim())) {
      name = `${name.trim()} 65`;
      quantityText = '';
    }
  }
  const description = tidyName(name);
  const quantity = quantityText ? quantityValue(quantityText) : 1;
  const lowerUnit = unit.toLowerCase();

  // Weights and fractions stay in the description; the line is billed as one amount.
  // Half portions ("½", "1½", "2.5") stay as quantities; weights and other fractions go in the name.
  const portion = quantity >= 0.5 && Number.isInteger(quantity * 2);
  if (!portion || /^(kgs?|g|gms?|grams?)$/.test(lowerUnit)) {
    const label = `${quantityText}${/^(kgs?)$/.test(lowerUnit) ? ' kg' : lowerUnit ? ` ${lowerUnit}` : ''}`;
    return { description: `${description} (${label})`, quantity: 1, unitPrice: lineAmount };
  }
  const perUnit = /^(days?|nights?)$/.test(lowerUnit) ? ` (per ${lowerUnit.replace(/s$/, '')})` : '';
  const unitPrice = Math.round((lineAmount / quantity) * 100) / 100;
  // Keep exact totals: if the amount doesn't divide evenly, bill it as one line and show the count.
  if (Math.abs(unitPrice * quantity - lineAmount) > 0.001) {
    const count = Number.isInteger(quantity) ? String(quantity) : `${Math.floor(quantity) || ''}½`;
    return { description: `${description} × ${count}`, quantity: 1, unitPrice: lineAmount };
  }
  return { description: description + perUnit, quantity, unitPrice };
}

export function parseNotes(rawLines: string[], reference = new Date()): NotesImport {
  const result: NotesImport = { stayLabel: '', stayStart: '', stayEnd: '', lines: [], declaredTotal: null, skipped: [] };
  let day = '';
  let meal = '';
  let afterTotal = false;

  // First pass: decide whether this note writes dates day-first or month-first.
  const allDates: DateParts[] = [];
  for (const raw of rawLines) {
    const line = raw.replace(/\s+/g, ' ').trim();
    const stay = line.match(/^check[\s-]*(in|out)\b\s*[:.-]?\s*(.*)$/i)?.[2].match(datePart);
    const heading = line.match(dateOnly);
    if (stay) allDates.push(datePieces(stay));
    else if (heading) allDates.push(datePieces(heading));
  }
  const order = chooseDateOrder(allDates, reference);
  const toIso = ([first, second, year]: DateParts) =>
    order === 'dm' ? isoDate(first, second, year, reference) : isoDate(second, first, year, reference);

  for (const raw of rawLines) {
    const line = raw.replace(/\s+/g, ' ').trim();
    if (!line) continue;

    const checkIn = line.match(/^check[\s-]*in\b\s*[:.-]?\s*(.*)$/i);
    const checkOut = line.match(/^check[\s-]*out\b\s*[:.-]?\s*(.*)$/i);
    if (checkIn || checkOut) {
      const date = (checkIn || checkOut)![1].match(datePart);
      if (date) {
        const value = toIso(datePieces(date));
        if (checkIn) result.stayStart = value;
        else result.stayEnd = value;
      }
      continue;
    }

    const dateLine = line.match(dateOnly);
    if (dateLine) {
      const iso = toIso(datePieces(dateLine));
      day = iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : line;
      meal = '';
      afterTotal = false;
      continue;
    }

    const total = line.match(new RegExp(String.raw`^(grand\s+|sub\s*-?\s*)?total\b[\s.:=-]*(?:rs\.?|₹)?\s*${amount}`, 'i'));
    if (total) {
      result.declaredTotal = money(total[2]);
      afterTotal = true;
      continue;
    }

    if (!/\d/.test(line) && mealWords.test(line.replace(/[:.\s]+$/, ''))) {
      meal = tidyName(line.replace(/[:.\s]+$/, ''));
      afterTotal = false;
      continue;
    }

    const item = line.match(dashAmount) || line.match(currencyAmount);
    if (item && /[a-z]/i.test(item[1])) {
      const lineAmount = money(item[2]);
      if (Number.isFinite(lineAmount) && lineAmount > 0) {
        const section = afterTotal ? 'Stay & extras' : [day, meal].filter(Boolean).join(' · ');
        result.lines.push({ section, ...splitItem(item[1], lineAmount), amount: lineAmount, source: line });
        continue;
      }
    }

    if (!result.stayLabel && roomLine.test(line)) {
      result.stayLabel = tidyName(line);
      continue;
    }

    result.skipped.push(line);
  }

  // A check-out earlier in the year than check-in means the stay crossed New Year.
  if (result.stayStart && result.stayEnd && result.stayEnd < result.stayStart) {
    const next = new Date(`${result.stayEnd}T00:00:00Z`);
    next.setUTCFullYear(next.getUTCFullYear() + 1);
    result.stayEnd = next.toISOString().slice(0, 10);
  }
  return result;
}
