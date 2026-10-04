export type View = 'overview' | 'tabs' | 'billing' | 'menu' | 'gallery';
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
};

export type Session = { authenticated: boolean; expiresAt: number | null };
export type Notify = (text: string, isError?: boolean) => void;

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
  lines: { description: string; quantity: number; unitPrice: number; section: string }[];
};
