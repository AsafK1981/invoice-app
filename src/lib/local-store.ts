"use client";

import { useEffect, useState } from "react";

interface Entity {
  id: string;
}

export interface LocalStore<T extends Entity> {
  load: () => T[];
  save: (item: T) => void;
  update: (id: string, patch: Partial<T>) => void;
  remove: (id: string) => void;
  reset: () => void;
  use: () => { items: T[]; ready: boolean };
}

export function createLocalStore<T extends Entity>(
  storageKey: string,
  seeds: T[],
  changeEvent: string,
): LocalStore<T> {
  function readStorage(): T[] | null {
    if (typeof window === "undefined") return null;
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as T[]) : null;
    } catch {
      return null;
    }
  }

  function writeStorage(items: T[]) {
    if (typeof window === "undefined") return;
    localStorage.setItem(storageKey, JSON.stringify(items));
    window.dispatchEvent(new Event(changeEvent));
  }

  function load(): T[] {
    const stored = readStorage();
    if (stored) return stored;
    writeStorage(seeds);
    return seeds;
  }

  function save(item: T) {
    const current = load();
    const idx = current.findIndex((i) => i.id === item.id);
    if (idx >= 0) {
      const next = [...current];
      next[idx] = item;
      writeStorage(next);
    } else {
      writeStorage([...current, item]);
    }
  }

  function update(id: string, patch: Partial<T>) {
    const current = load();
    writeStorage(current.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  }

  function remove(id: string) {
    const current = load();
    writeStorage(current.filter((i) => i.id !== id));
  }

  function reset() {
    writeStorage(seeds);
  }

  function use() {
    const [items, setItems] = useState<T[]>([]);
    const [ready, setReady] = useState(false);

    useEffect(() => {
      setItems(load());
      setReady(true);

      const handler = () => setItems(load());
      window.addEventListener(changeEvent, handler);
      window.addEventListener("storage", handler);
      return () => {
        window.removeEventListener(changeEvent, handler);
        window.removeEventListener("storage", handler);
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return { items, ready };
  }

  return { load, save, update, remove, reset, use };
}
