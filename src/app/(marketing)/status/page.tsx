import StatusV2Client from "./StatusV2Client";

export const metadata = {
  title: "סטטוס המערכת | חשבונית",
};

/**
 * /v2/status, server wrapper that owns the page metadata (title). The
 * live health-check UI is a client component (StatusV2Client), since a
 * "use client" module cannot itself export `metadata`.
 */
export default function V2StatusPage() {
  return <StatusV2Client />;
}
