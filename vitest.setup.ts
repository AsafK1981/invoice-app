import { vi, beforeEach } from "vitest";

// Stub env vars that some imported modules read at module load time.
// Tests don't actually hit Supabase; the values just have to be non-empty
// so client construction doesn't throw.
process.env.NEXT_PUBLIC_SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://test.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "test-anon-key";

class MemoryStorage implements Storage {
  private store = new Map<string, string>();
  get length() {
    return this.store.size;
  }
  key(i: number): string | null {
    return Array.from(this.store.keys())[i] ?? null;
  }
  getItem(k: string): string | null {
    return this.store.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.store.set(k, String(v));
  }
  removeItem(k: string): void {
    this.store.delete(k);
  }
  clear(): void {
    this.store.clear();
  }
}

const storage = new MemoryStorage();

vi.stubGlobal("localStorage", storage);
vi.stubGlobal("window", { localStorage: storage });

beforeEach(() => {
  storage.clear();
});
