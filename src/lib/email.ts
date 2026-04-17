export interface SendReceiptEmailArgs {
  to: string;
  clientName: string;
  receiptNumber: number;
  total: number;
  businessName: string;
}

export interface SendEmailResult {
  ok: boolean;
  messageId?: string;
  error?: string;
  mocked: boolean;
}

export async function sendReceiptEmail(args: SendReceiptEmailArgs): Promise<SendEmailResult> {
  if (!args.to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(args.to)) {
    return { ok: false, error: "כתובת אימייל לא תקינה", mocked: true };
  }

  await new Promise((r) => setTimeout(r, 600));

  console.log("[mock email]", {
    to: args.to,
    subject: `קבלה #${args.receiptNumber} מאת ${args.businessName}`,
    body: `שלום ${args.clientName}, מצורפת קבלה על סך ${args.total} ש"ח.`,
  });

  return {
    ok: true,
    messageId: `mock-${Date.now()}`,
    mocked: true,
  };
}
