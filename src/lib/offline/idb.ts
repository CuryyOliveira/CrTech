/**
 * Persistência local do modo offline em IndexedDB.
 *
 * O acesso aos dados continua sendo síncrono para o restante do aplicativo:
 * mantemos um espelho em memória e gravamos no IndexedDB em segundo plano.
 * Chame `hidratarOffline()` antes de qualquer leitura (o `dbOffline` já faz).
 */

const BANCO = "conferencia-offline";
const LOJA = "dados";
const VERSAO = 1;

type Mapa = Record<string, unknown>;

const memoria: Mapa = {};
let hidratado = false;
let hidratando: Promise<void> | null = null;

function abrir(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(BANCO, VERSAO);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(LOJA)) db.createObjectStore(LOJA);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

let conexao: Promise<IDBDatabase | null> | null = null;

function banco() {
  conexao ??= abrir();
  return conexao;
}

/** Carrega tudo do IndexedDB (e migra o que existia em localStorage). */
export function hidratarOffline(): Promise<void> {
  if (hidratado) return Promise.resolve();
  hidratando ??= (async () => {
    const db = await banco();
    if (db) {
      await new Promise<void>((resolve) => {
        try {
          const tx = db.transaction(LOJA, "readonly");
          const loja = tx.objectStore(LOJA);
          const chaves = loja.getAllKeys();
          const valores = loja.getAll();
          tx.oncomplete = () => {
            (chaves.result as IDBValidKey[]).forEach((k, i) => {
              memoria[String(k)] = (valores.result as unknown[])[i];
            });
            resolve();
          };
          tx.onerror = () => resolve();
        } catch {
          resolve();
        }
      });
    }
    // Migração única do armazenamento antigo (localStorage).
    if (typeof localStorage !== "undefined") {
      for (let i = 0; i < localStorage.length; i++) {
        const chave = localStorage.key(i);
        if (!chave || (!chave.startsWith("cr:cache:") && chave !== "cr:fila")) continue;
        if (memoria[chave] !== undefined) continue;
        try {
          memoria[chave] = JSON.parse(localStorage.getItem(chave) ?? "null");
          gravarLocal(chave, memoria[chave]);
        } catch {
          /* valor corrompido: ignora */
        }
      }
    }
    hidratado = true;
  })();
  return hidratando;
}

/** true quando os dados locais já foram carregados em memória. */
export function offlinePronto() {
  return hidratado;
}

export function lerLocal<T>(chave: string, padrao: T): T {
  const v = memoria[chave];
  return v === undefined || v === null ? padrao : (v as T);
}

export function gravarLocal(chave: string, valor: unknown) {
  memoria[chave] = valor;
  void banco().then((db) => {
    if (!db) return;
    try {
      db.transaction(LOJA, "readwrite").objectStore(LOJA).put(valor, chave);
    } catch {
      /* falha de gravação não deve interromper a operação do usuário */
    }
  });
}

export function removerLocal(chave: string) {
  delete memoria[chave];
  void banco().then((db) => {
    if (!db) return;
    try {
      db.transaction(LOJA, "readwrite").objectStore(LOJA).delete(chave);
    } catch {
      /* ignora */
    }
  });
}
