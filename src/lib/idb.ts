/**
 * IndexedDB as a few promise-returning key/value stores. Where IndexedDB isn't available (some private
 * windows, blocked site data) the stores live in memory for the session, so the app still works.
 */

export interface KvStore<T> {
  all(): Promise<[string, T][]>;
  put(key: string, value: T): Promise<void>;
  del(key: string): Promise<void>;
}

const req = <R>(r: IDBRequest<R>) => new Promise<R>((ok, fail) => { r.onsuccess = () => ok(r.result); r.onerror = () => fail(r.error); });

function open(name: string, stores: readonly string[]): Promise<IDBDatabase> {
  return new Promise((ok, fail) => {
    const r = indexedDB.open(name, 1);
    r.onupgradeneeded = () => { for (const s of stores) if (!r.result.objectStoreNames.contains(s)) r.result.createObjectStore(s); };
    r.onsuccess = () => ok(r.result);
    r.onerror = () => fail(r.error);
    r.onblocked = () => fail(new Error('IndexedDB blocked'));
  });
}

function idbStore<T>(db: IDBDatabase, name: string): KvStore<T> {
  const tx = (mode: IDBTransactionMode) => db.transaction(name, mode).objectStore(name);
  return {
    async all() {
      const s = tx('readonly');
      const [keys, values] = await Promise.all([req(s.getAllKeys()), req(s.getAll())]);
      return keys.map((k, i) => [String(k), values[i] as T]);
    },
    put: (key, value) => req(tx('readwrite').put(value, key)).then(() => undefined),
    del: key => req(tx('readwrite').delete(key)).then(() => undefined),
  };
}

function memoryStore<T>(): KvStore<T> {
  const m = new Map<string, T>();
  return {
    all: async () => [...m.entries()],
    put: async (k, v) => { m.set(k, v); },
    del: async k => { m.delete(k); },
  };
}

/** Open (creating as needed) a database with these stores. `persistent` says whether it outlives the page. */
export async function openStores<K extends string>(name: string, stores: readonly K[]): Promise<{ stores: Record<K, KvStore<any>>; persistent: boolean }> {
  try {
    const db = await open(name, stores);
    return { stores: Object.fromEntries(stores.map(s => [s, idbStore(db, s)])) as Record<K, KvStore<any>>, persistent: true };
  } catch {
    return { stores: Object.fromEntries(stores.map(s => [s, memoryStore()])) as Record<K, KvStore<any>>, persistent: false };
  }
}
