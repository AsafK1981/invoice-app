// Thin re-export so every /vs/* page keeps its existing import path.
// The actual builder is shared with the other marketing pages (privacy,
// terms, status, blog) at src/lib/page-metadata.ts.
export { pageMetadata as vsMetadata } from "@/lib/page-metadata";
