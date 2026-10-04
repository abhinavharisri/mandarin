export type View = 'overview' | 'gallery' | 'billing';
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
