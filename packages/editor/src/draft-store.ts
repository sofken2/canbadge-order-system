// 途中保存（ブラウザ内）。作りかけのデザインと、写真を、この端末のブラウザ（IndexedDB）に残す。
// リロードしたり、ブラウザを閉じたりしても、続きから再開できる。サーバーには送らない。
// 使えない環境（プライベートモード・容量の上限など）では、何もしない（失敗にはしない）。

const DB_NAME = "canbadge-editor";
const STORE = "drafts";

/** 途中保存の有効期間。学祭の 1 日を超えて残ると、前の人のデザインが出てしまうので、短くする */
export const DRAFT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export type Draft = {
  savedAt: number;
  /** model.ts の EditorState。読み戻すときに、parseEditorState で検証する */
  editorData: unknown;
  /** 読み込んだ写真（もとのファイル）。読み戻すときに、同じ手順で読み込み直す */
  image: Blob;
};

/** 保存した時刻が、有効期間の中か。端末の時計が少しずれていても（未来の時刻でも）、1 分までは許す */
export function isDraftFresh(
  savedAt: number,
  now: number,
  maxAgeMs: number = DRAFT_MAX_AGE_MS,
): boolean {
  return savedAt <= now + 60_000 && now - savedAt <= maxAgeMs;
}

function openDatabase(): Promise<IDBDatabase | undefined> {
  return new Promise((resolve) => {
    if (typeof indexedDB === "undefined") return resolve(undefined);
    try {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(undefined);
      request.onblocked = () => resolve(undefined);
    } catch {
      resolve(undefined);
    }
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | undefined> {
  const db = await openDatabase();
  if (!db) return undefined;
  return new Promise((resolve) => {
    try {
      const transaction = db.transaction(STORE, mode);
      const request = run(transaction.objectStore(STORE));
      transaction.oncomplete = () => {
        db.close();
        resolve(request.result);
      };
      transaction.onerror = () => {
        db.close();
        resolve(undefined);
      };
      transaction.onabort = () => {
        db.close();
        resolve(undefined);
      };
    } catch {
      db.close();
      resolve(undefined);
    }
  });
}

/** 保存する。できたら true */
export async function saveDraft(key: string, draft: Draft): Promise<boolean> {
  const saved = await withStore("readwrite", (store) => store.put(draft, key));
  return saved !== undefined;
}

/** 読み戻す。なければ・期限が切れていれば・形が違えば undefined（期限切れは、消しておく） */
export async function loadDraft(key: string, now: number = Date.now()): Promise<Draft | undefined> {
  const value = (await withStore("readonly", (store) => store.get(key))) as
    | Partial<Draft>
    | undefined;
  if (!value || typeof value.savedAt !== "number" || !(value.image instanceof Blob))
    return undefined;
  if (!isDraftFresh(value.savedAt, now)) {
    await clearDraft(key);
    return undefined;
  }
  return { savedAt: value.savedAt, editorData: value.editorData, image: value.image };
}

export async function clearDraft(key: string): Promise<void> {
  await withStore("readwrite", (store) => store.delete(key));
}
