import type { MetadataRoute } from "next";

const BASE = "https://mysuperfriendlyinvoiceapp.vercel.app";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return [
    { url: `${BASE}/`, lastModified: now, changeFrequency: "weekly", priority: 1.0 },
    { url: `${BASE}/vs`, lastModified: now, changeFrequency: "monthly", priority: 0.9 },
    { url: `${BASE}/vs/invoice4u`, lastModified: now, changeFrequency: "monthly", priority: 0.9 },
    { url: `${BASE}/vs/greeninvoice`, lastModified: now, changeFrequency: "monthly", priority: 0.9 },
    { url: `${BASE}/vs/ifreelance`, lastModified: now, changeFrequency: "monthly", priority: 0.9 },
    { url: `${BASE}/privacy`, lastModified: now, changeFrequency: "yearly", priority: 0.5 },
    { url: `${BASE}/terms`, lastModified: now, changeFrequency: "yearly", priority: 0.5 },
    { url: `${BASE}/status`, lastModified: now, changeFrequency: "always", priority: 0.3 },
  ];
}
