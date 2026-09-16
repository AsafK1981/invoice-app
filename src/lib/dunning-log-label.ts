// How one dunning_log row reads in the document timeline. Pure, so every case
// is unit-tested (tests/dunning-pre-due.test.ts).
//
// Three kinds of row share that table:
//  * channel 'email' (or null on very old rows): an email this app sent to the
//    client, day_bucket 3 / 14 / 30;
//  * the same channel with day_bucket PRE_DUE_BUCKET: the friendly email sent
//    before the due date;
//  * channel 'whatsapp_assist': a reminder PREPARED for the owner. The app
//    never sends it, so it must not read as "sent".

import { PRE_DUE_BUCKET } from "./dunning-copy";
import { WHATSAPP_ASSIST_CHANNEL } from "./assisted-dunning";

export interface DunningLogLabelRow {
  day_bucket: number;
  success: boolean;
  channel?: string | null;
}

export type DunningLogLabelKind = "email" | "email_failed" | "whatsapp";

export function dunningLogLabel(row: DunningLogLabelRow): { title: string; kind: DunningLogLabelKind } {
  if (row.channel === WHATSAPP_ASSIST_CHANNEL) {
    return { title: `הוכנה תזכורת בוואטסאפ (יום ${row.day_bucket})`, kind: "whatsapp" };
  }
  if (row.day_bucket === PRE_DUE_BUCKET) {
    return row.success
      ? { title: "נשלחה תזכורת ידידותית לפני מועד התשלום", kind: "email" }
      : { title: "כשל בשליחת תזכורת ידידותית לפני מועד התשלום", kind: "email_failed" };
  }
  return row.success
    ? { title: `נשלחה תזכורת תשלום (יום ${row.day_bucket})`, kind: "email" }
    : { title: `כשל בשליחת תזכורת (יום ${row.day_bucket})`, kind: "email_failed" };
}
