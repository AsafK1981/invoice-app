import StatusV2Client from "./StatusV2Client";
import { pageMetadata } from "@/lib/page-metadata";

export const metadata = pageMetadata({
  path: "/status",
  title: "סטטוס המערכת",
  ogTitle: "סטטוס המערכת | חשבונית ידידותית",
  description:
    "סטטוס חי של חשבונית ידידותית: זמינות מסד הנתונים, אחסון הקבצים ומערכת ההתחברות בזמן אמת, מתעדכן אוטומטית כל 30 שניות ללא צורך לרענן.",
});

/**
 * /v2/status, server wrapper that owns the page metadata (title). The
 * live health-check UI is a client component (StatusV2Client), since a
 * "use client" module cannot itself export `metadata`.
 */
export default function V2StatusPage() {
  return <StatusV2Client />;
}
