export type View = 'overview' | 'tabs' | 'billing' | 'menu' | 'reports' | 'reviews' | 'gallery';
export type Category = 'rooms' | 'common' | 'exteriors' | 'landscapes';

export type GalleryImage = {
  id: string;
  alt_text: string;
  category: Category;
  image_url: string;
  full_image_url?: string;
  created_at: string;
};

export type InvoiceSummary = {
  id: string;
  invoice_number: string;
  guest_name: string;
  guest_email?: string | null;
  total_amount: number;
  currency: string;
  created_at: string;
  stay_label?: string | null;
  advance_paid?: number;
  balance_due?: number;
  revision?: number;
};

export type Session = { authenticated: boolean; expiresAt: number | null };

/** A full invoice record, as loaded for editing. */
export type InvoiceDetail = InvoiceSummary & {
  stay_label?: string | null;
  stay_start?: string;
  stay_end?: string;
  tax_rate?: number;
  advance_paid?: number;
  line_items?: { description: string; quantity: number; unitPrice: number; section?: string; itemId?: string }[];
  revision?: number;
  has_source_bill?: boolean;
};
/** Shows a toast; `action` adds a button such as Undo. */
export type Notify = (text: string, isError?: boolean, action?: { label: string; run: () => void }) => void;

export const categories: { id: Category; label: string }[] = [
  { id: 'rooms', label: 'Rooms' },
  { id: 'common', label: 'Common areas' },
  { id: 'exteriors', label: 'Exteriors' },
  { id: 'landscapes', label: 'Landscapes' },
];

export type Diet = 'veg' | 'nonveg' | 'egg';
/** `price: null` means "as per availability": the price is entered when ordering. */
export type MenuOption = { label: string; price: number | null };
export type MenuItem = { id: string; name: string; category: string; diet: Diet; options: MenuOption[]; available: boolean };
export type Menu = { items: MenuItem[]; updated_at: string | null };

export type TabOrder = {
  id: string;
  item_id: string | null;
  name: string;
  option: string;
  quantity: number;
  unit_price: number;
  section: string;
  created_at: string;
};

export type TabSummary = {
  id: string;
  label: string;
  guest_name: string;
  guest_email: string;
  check_in: string;
  advance_paid?: number;
  status: 'open' | 'closed';
  created_at: string;
  updated_at: string;
  order_count: number;
  total: number;
  last_order_at: string | null;
  invoice_number?: string;
  closed_at?: string;
};

export type Tab = Omit<TabSummary, 'order_count' | 'total' | 'last_order_at'> & { orders: TabOrder[] };

/** A line chosen in the menu picker, before it becomes an invoice line or tab order. */
export type PickedLine = { itemId: string | null; name: string; option: string; quantity: number; unitPrice: number };

/** Pre-filled invoice handed from a tab to the Billing page. */
export type InvoiceDraft = {
  tabId: string;
  guestName: string;
  guestEmail: string;
  stayStart: string;
  stayEnd: string;
  stayLabel: string;
  advancePaid: number;
  lines: { description: string; quantity: number; unitPrice: number; section: string; itemId?: string }[];
};

export type Report = {
  from: string;
  to: string;
  granularity: 'day' | 'month';
  totals: { revenue: number; invoices: number; average: number; tax: number; food: number; room: number; extras: number; unitemised: number; unitemisedInvoices: number };
  trend: { key: string; label: string; total: number; count: number }[];
  byStay: { label: string; total: number; count: number }[];
  topItems: { name: string; quantity: number; revenue: number }[];
  register: { id: string; invoice_number: string; date: string; guest_name: string; stay_label: string; subtotal: number | null; tax: number | null; total: number; advance: number; balance: number }[];
  lines: { invoice_number: string; date: string; stay_label: string; section: string; category: string; description: string; quantity: number; unit_price: number; amount: number }[];
};
