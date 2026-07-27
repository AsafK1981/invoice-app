// Synthetic dataset generator for OPENFORMAT 1.31 simulator validation.
//
// The Tax Authority's simulator requires a minimum of 2000 records that
// include examples of every document type the software produces. Asaf's
// real data has ~20 records, so for the מרשם תוכנות registration we
// substitute a deterministic sample dataset covering all 5 doc types
// plus expenses and a sizable client list.
//
// Deterministic = same inputs always produce the same output, so reruns
// of the simulator give identical results.

import type { Business, Client, DocumentItem, Expense, InvoiceDocument, DocumentType, PaymentMethod } from "../types";

// Deterministic pseudo-random generator (mulberry32) seeded with a fixed
// integer so the dataset never drifts between runs.
function makeRng(seed: number) {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST_NAMES = [
  "אסף", "דנה", "רון", "ליאת", "תומר", "מיכל", "יואב", "שרה", "אבי", "טל",
  "נועה", "עומר", "ענת", "גיל", "רחל", "אורי", "דוד", "מאיה", "אריאל", "יעל",
  "אלון", "הילה", "אמיר", "שירה", "עידן", "גלית", "ניר", "אורית", "אייל", "אורנה",
];

const LAST_NAMES = [
  "כהן", "לוי", "מזרחי", "פרץ", "ביטון", "אזולאי", "אברהם", "פרידמן", "דהן", "אוחיון",
  "חדד", "עמר", "סבג", "טל", "שמש", "ברק", "כהן-לוי", "אדרי", "ארביב", "אטיאס",
];

const BUSINESS_SUFFIXES = ["בע״מ", "ושות׳", "הנדסה", "שיווק", "ייעוץ", "פרויקטים", "שירותים"];

const SERVICE_DESCRIPTIONS = [
  "שירותי פיתוח תוכנה",
  "ייעוץ עסקי",
  "פיתוח אתר אינטרנט",
  "תחזוקה חודשית",
  "ניתוח מערכות",
  "הקמת תשתית ענן",
  "ביצוע אינטגרציה",
  "מערכת ניהול לקוחות",
  "אופטימיזציה לחיפוש",
  "מערכת דיווח",
];

const EXPENSE_CATEGORIES = [
  "תוכנה", "חומרה", "תקשורת", "תחבורה", "כיבוד", "ציוד משרדי", "פרסום", "ביטוח", "ייעוץ", "השתלמויות",
];

const EXPENSE_SUPPLIERS = [
  "Vercel Inc", "AWS", "Google Cloud", "Microsoft", "Bezeq International",
  "סלקום", "פרטנר", "Office Depot", "מקדונלד׳ס", "סטארבקס",
];

const PAYMENT_METHODS: PaymentMethod[] = ["bank_transfer", "cash", "check", "credit_card", "bit"];

// Document type distribution: must include at least one of each
const DOC_TYPES: DocumentType[] = [
  "receipt",
  "quote",
  "proforma",
  "tax_invoice",
  "tax_invoice_receipt",
  "credit_note",
];

interface SampleInput {
  business: Business;
  /** Tax year for all generated dates (2026 / 2025 etc). */
  taxYear: number;
  /** Target record count after generation (>= 2000 required by simulator). */
  targetRecords?: number;
}

export interface SampleDataset {
  clients: Client[];
  documents: InvoiceDocument[];
  expenses: Expense[];
}

/**
 * Generates a sample dataset large enough to satisfy the simulator's
 * 2000-record minimum, with at least one document of each type.
 */
export function generateSampleDataset(input: SampleInput): SampleDataset {
  const rng = makeRng(20260520);
  const targetRecords = input.targetRecords ?? 2500;
  const year = input.taxYear;

  // We aim slightly above the 2000 target. Rough record budget:
  //   - 50 clients      ~ 50 B110 + ~5 standard B110     = 55 records
  //   - 300 documents   ~ 300 C100 + ~600 D110 + ~150 D120 = 1050 records
  //   - 600 B100 lines (~2 per paid doc)                 = 600 records
  //   - 100 expenses (~2 B100 per expense)               = 200 records
  //   - 1 A100 + 1 Z900                                  = 2 records
  //   Total target: ~1907 records, scale up if needed.

  const numClients = Math.max(50, Math.floor(targetRecords / 50));
  const numDocs = Math.max(300, Math.floor(targetRecords / 7));
  const numExpenses = Math.max(50, Math.floor(targetRecords / 25));

  const clients: Client[] = [];
  for (let i = 0; i < numClients; i++) {
    const isBusiness = rng() < 0.6;
    const fn = FIRST_NAMES[Math.floor(rng() * FIRST_NAMES.length)];
    const ln = LAST_NAMES[Math.floor(rng() * LAST_NAMES.length)];
    const name = isBusiness
      ? `${ln} ${BUSINESS_SUFFIXES[Math.floor(rng() * BUSINESS_SUFFIXES.length)]}`
      : `${fn} ${ln}`;
    const taxId = isBusiness
      ? String(510000000 + Math.floor(rng() * 89999999)).padStart(9, "0")
      : String(100000000 + Math.floor(rng() * 899999999)).padStart(9, "0");
    clients.push({
      id: `sample-client-${i.toString().padStart(4, "0")}`,
      name,
      taxId,
      address: `רחוב ${LAST_NAMES[Math.floor(rng() * LAST_NAMES.length)]} ${Math.floor(rng() * 99) + 1}, תל אביב`,
      phone: `05${Math.floor(rng() * 10)}-${Math.floor(rng() * 9000000 + 1000000)}`,
      email: `client${i}@example.co.il`,
      createdAt: `${year}-01-01`,
    });
  }

  const documents: InvoiceDocument[] = [];
  // Counters per type for sequential numbering
  const numberByType: Record<DocumentType, number> = {
    receipt: 1001,
    quote: 201,
    proforma: 201,
    tax_invoice: 201,
    tax_invoice_receipt: 201,
    credit_note: 201,
  };
  // Ensure first 5 docs are one of each type
  for (let i = 0; i < numDocs; i++) {
    const type = i < DOC_TYPES.length
      ? DOC_TYPES[i]
      : DOC_TYPES[Math.floor(rng() * DOC_TYPES.length)];
    const client = clients[Math.floor(rng() * clients.length)];
    // Spread across the year
    const dayOfYear = Math.floor(rng() * 360) + 1;
    const date = new Date(year, 0, dayOfYear).toISOString().slice(0, 10);

    const numItems = 1 + Math.floor(rng() * 3);
    const items: DocumentItem[] = [];
    let subtotal = 0;
    for (let j = 0; j < numItems; j++) {
      const qty = 1 + Math.floor(rng() * 5);
      const price = 100 + Math.floor(rng() * 2000);
      const total = qty * price;
      subtotal += total;
      items.push({
        id: `sample-item-${i}-${j}`,
        description: SERVICE_DESCRIPTIONS[Math.floor(rng() * SERVICE_DESCRIPTIONS.length)],
        quantity: qty,
        unitPrice: price,
        total,
      });
    }
    // עוסק פטור = no VAT. For type=tax_invoice we still set vat=0 since
    // Asaf is exempt; the simulator doesn't care about מע"מ correctness.
    const vat = 0;
    const total = subtotal + vat;

    const status: InvoiceDocument["status"] =
      (type === "quote" || type === "proforma") && rng() < 0.3 ? "draft" : "paid";

    const paymentMethod =
      type === "receipt" || type === "tax_invoice_receipt"
        ? PAYMENT_METHODS[Math.floor(rng() * PAYMENT_METHODS.length)]
        : undefined;

    documents.push({
      id: `sample-doc-${i.toString().padStart(4, "0")}`,
      type,
      number: numberByType[type]++,
      date,
      clientId: client.id,
      clientName: client.name,
      subject: rng() < 0.3 ? SERVICE_DESCRIPTIONS[Math.floor(rng() * SERVICE_DESCRIPTIONS.length)] : undefined,
      status,
      items,
      subtotal,
      vat,
      total,
      paymentMethod,
    });
  }

  const expenses: Expense[] = [];
  for (let i = 0; i < numExpenses; i++) {
    const dayOfYear = Math.floor(rng() * 360) + 1;
    const date = new Date(year, 0, dayOfYear).toISOString().slice(0, 10);
    expenses.push({
      id: `sample-exp-${i.toString().padStart(4, "0")}`,
      date,
      category: EXPENSE_CATEGORIES[Math.floor(rng() * EXPENSE_CATEGORIES.length)],
      supplier: EXPENSE_SUPPLIERS[Math.floor(rng() * EXPENSE_SUPPLIERS.length)],
      amount: 50 + Math.floor(rng() * 1500),
      description: `הוצאה לדוגמה ${i}`,
      vatAmount: 0,
    });
  }

  return { clients, documents, expenses };
}
