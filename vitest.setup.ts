import { vi, beforeEach } from "vitest";

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
