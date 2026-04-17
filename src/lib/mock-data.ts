import type { Business, Client, Product, InvoiceDocument, Expense } from "./types";

export const mockBusiness: Business = {
  id: "b1",
  name: "העסק שלי",
  businessType: "exempt",
  taxId: "123456789",
  address: "רחוב הרצל 1, תל אביב",
  phone: "050-1234567",
  email: "asafkotlar@gmail.com",
};

export const mockClients: Client[] = [
  {
    id: "c1",
    name: "חברת אלפא בע״מ",
    taxId: "514123456",
    address: "דיזנגוף 100, תל אביב",
    phone: "03-1234567",
    email: "contact@alpha.co.il",
    notes: "לקוח VIP",
    createdAt: "2025-09-15",
  },
  {
    id: "c2",
    name: "בטא סטודיו",
    taxId: "515987654",
    address: "אלנבי 50, תל אביב",
    email: "hello@beta-studio.com",
    createdAt: "2025-11-02",
  },
  {
    id: "c3",
    name: "דני כהן",
    taxId: "032145678",
    phone: "052-9876543",
    email: "dani.cohen@gmail.com",
    createdAt: "2026-01-10",
  },
  {
    id: "c4",
    name: "גמא טכנולוגיות",
    taxId: "516234567",
    address: "רוטשילד 22, תל אביב",
    email: "finance@gamma.tech",
    createdAt: "2026-02-20",
  },
];

export const mockProducts: Product[] = [
  {
    id: "p1",
    name: "ייעוץ טכנולוגי - שעה",
    description: "ייעוץ שעתי בנושאי ארכיטקטורה ופיתוח",
    price: 450,
    unit: "שעה",
  },
  {
    id: "p2",
    name: "פיתוח תוכנה - יום עבודה",
    description: "יום פיתוח מלא (8 שעות)",
    price: 3200,
    unit: "יום",
  },
  {
    id: "p3",
    name: "Code Review",
    description: "בחינה מקיפה של קוד קיים והמלצות",
    price: 1500,
    unit: "פרויקט",
  },
  {
    id: "p4",
    name: "הדרכה / סדנה",
    description: "סדנת 4 שעות לצוות",
    price: 2400,
    unit: "סדנה",
  },
];

export const mockDocuments: InvoiceDocument[] = [
  {
    id: "d1",
    type: "receipt",
    number: 1001,
    date: "2026-04-10",
    clientId: "c1",
    clientName: "חברת אלפא בע״מ",
    subject: "ייעוץ טכנולוגי - אפריל 2026",
    status: "paid",
    items: [
      { id: "i1", productId: "p1", description: "ייעוץ טכנולוגי - שעה", quantity: 10, unitPrice: 450, total: 4500 },
    ],
    subtotal: 4500,
    vat: 0,
    total: 4500,
    paymentMethod: "bank_transfer",
  },
  {
    id: "d2",
    type: "quote",
    number: 201,
    date: "2026-04-08",
    clientId: "c2",
    clientName: "בטא סטודיו",
    subject: "פיתוח אתר - שלב 1",
    status: "sent",
    items: [
      { id: "i2", productId: "p2", description: "פיתוח תוכנה - יום עבודה", quantity: 5, unitPrice: 3200, total: 16000 },
    ],
    subtotal: 16000,
    vat: 0,
    total: 16000,
    notes: "הצעה בתוקף ל-30 יום",
  },
  {
    id: "d3",
    type: "receipt",
    number: 1002,
    date: "2026-04-02",
    clientId: "c3",
    clientName: "דני כהן",
    subject: "ביקורת קוד - פרויקט React",
    status: "paid",
    items: [
      { id: "i3", productId: "p3", description: "Code Review", quantity: 1, unitPrice: 1500, total: 1500 },
    ],
    subtotal: 1500,
    vat: 0,
    total: 1500,
    paymentMethod: "bank_transfer",
  },
  {
    id: "d4",
    type: "receipt",
    number: 1003,
    date: "2026-03-28",
    clientId: "c4",
    clientName: "גמא טכנולוגיות",
    subject: "סדנאות TypeScript - מרץ",
    status: "paid",
    items: [
      { id: "i4", productId: "p4", description: "הדרכה / סדנה", quantity: 2, unitPrice: 2400, total: 4800 },
    ],
    subtotal: 4800,
    vat: 0,
    total: 4800,
    paymentMethod: "bank_transfer",
  },
  {
    id: "d5",
    type: "receipt",
    number: 1004,
    date: "2026-03-15",
    clientId: "c1",
    clientName: "חברת אלפא בע״מ",
    subject: "ייעוץ טכנולוגי - מרץ 2026",
    status: "paid",
    items: [
      { id: "i5", productId: "p1", description: "ייעוץ טכנולוגי - שעה", quantity: 8, unitPrice: 450, total: 3600 },
    ],
    subtotal: 3600,
    vat: 0,
    total: 3600,
    paymentMethod: "bank_transfer",
  },
];

export const mockExpenses: Expense[] = [
  { id: "e1", date: "2026-04-05", category: "תוכנה", supplier: "Vercel", amount: 80, description: "אחסון חודשי" },
  { id: "e2", date: "2026-04-01", category: "ציוד", supplier: "KSP", amount: 450, description: "אביזרי מחשב" },
  { id: "e3", date: "2026-03-20", category: "תוכנה", supplier: "GitHub", amount: 40, description: "מנוי חודשי" },
  { id: "e4", date: "2026-03-10", category: "שיווק", supplier: "Google Ads", amount: 320 },
];
