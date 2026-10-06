/**
 * Banco local estruturado (IndexedDB), SEPARADO POR USUÁRIO.
 *
 * Um banco por usuário: `cr-v2:<userId>`. Cada tipo de dado tem o seu object store (nada de
 * "tabela inteira numa única chave"). Toda gravação AGUARDA a confirmação da transação
 * (oncomplete) antes de responder: se o app for fechado logo depois, o dado já está no disco.
 */

/**
 * Índices COMPOSTOS ([campo, chave única]): cada entrada do índice é única, o que mantém
 * inserções/remoções em O(log n) mesmo com milhares de registros no mesmo status/conferência.
 * A consulta por valor usa o intervalo [valor] … [valor, []].
 */
export const STORES = {
  sessao: { keyPath: "chave" },
  usuario: { keyPath: "chave" },
  empresa: { keyPath: "chave" },
  unidades: { keyPath: "id", indices: { empresa_id: ["empresa_id", "id"] } },
  materiais: { keyPath: "id", indices: { unidade_id: ["unidade_id", "id"] } },
  conferencias: { keyPath: "id", indices: { unidade_id: ["unidade_id", "id"] } },
  itens: { keyPath: "k", indices: { conferencia_id: ["conferencia_id", "k"], id: ["id", "k"] } },
  eventos: { keyPath: "event_id", indices: { conference_id: ["conference_id", "seq"] } },
  fila: {
    keyPath: "event_id",
    indices: {
      status: ["status", "seq"],
      conference_id: ["conference_id", "seq"],
    },
  },
  sincronizacao: { keyPath: "chave" },
  fotos: {
    keyPath: "id",
    indices: { status: ["status", "id"], conferencia_id: ["conferencia_id", "id"] },
  },
  logs: { keyPath: "n", autoIncrement: true },
} as const;

/** Intervalo que seleciona todas as entradas de um índice composto cujo 1º campo = valor. */
function faixa(valor: IDBValidKey) {
  return IDBKeyRange.bound([valor], [valor, []]);
}

export type NomeStore = keyof typeof STORES;
export const VERSAO_BANCO = 1;

export function nomeBancoUsuario(userId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(userId)) throw new Error("Usuário inválido para o banco local");
  return `cr-v2:${userId.toLowerCase()}`;
}

function promessa<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((ok, erro) => {
    req.onsuccess = () => ok(req.result);
    req.onerror = () => erro(req.error);
  });
}

export type Transacao = {
  get<T>(store: NomeStore, chave: IDBValidKey): Promise<T | undefined>;
  put(store: NomeStore, valor: unknown): Promise<void>;
  delete(store: NomeStore, chave: IDBValidKey): Promise<void>;
  porIndice<T>(store: NomeStore, indice: string, valor: IDBValidKey): Promise<T[]>;
  todos<T>(store: NomeStore): Promise<T[]>;
  contar(store: NomeStore, indice: string, valor: IDBValidKey): Promise<number>;
  limpar(store: NomeStore): Promise<void>;
};

export class BancoLocal {
  private constructor(
    readonly nome: string,
    private readonly db: IDBDatabase,
  ) {}

  static async abrir(userId: string, fabrica: IDBFactory = indexedDB): Promise<BancoLocal> {
    const nome = nomeBancoUsuario(userId);
    const req = fabrica.open(nome, VERSAO_BANCO);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const [store, def] of Object.entries(STORES)) {
        if (db.objectStoreNames.contains(store)) continue;
        const os = db.createObjectStore(store, {
          keyPath: def.keyPath,
          autoIncrement: "autoIncrement" in def ? def.autoIncrement : false,
        });
        if ("indices" in def) {
          for (const [indice, caminho] of Object.entries(def.indices))
            os.createIndex(indice, caminho);
        }
      }
    };
    const db = await promessa(req);
    return new BancoLocal(nome, db);
  }

  fechar() {
    this.db.close();
  }

  /**
   * Executa `fn` numa ÚNICA transação e só resolve depois que ela foi confirmada no disco.
   * Se `fn` lançar erro, a transação é abortada e nada é gravado (atomicidade).
   */
  async transacao<T>(
    stores: NomeStore[],
    modo: IDBTransactionMode,
    fn: (t: Transacao) => Promise<T>,
  ): Promise<T> {
    const tx = this.db.transaction(stores, modo);
    const concluida = new Promise<void>((ok, erro) => {
      tx.oncomplete = () => ok();
      tx.onabort = () => erro(tx.error ?? new Error("Transação local abortada"));
      tx.onerror = () => erro(tx.error ?? new Error("Erro na transação local"));
    });
    const t: Transacao = {
      get: (s, k) => promessa(tx.objectStore(s).get(k)),
      put: async (s, v) => {
        await promessa(tx.objectStore(s).put(v));
      },
      delete: async (s, k) => {
        await promessa(tx.objectStore(s).delete(k));
      },
      porIndice: (s, i, v) => promessa(tx.objectStore(s).index(i).getAll(faixa(v))),
      todos: (s) => promessa(tx.objectStore(s).getAll()),
      contar: (s, i, v) => promessa(tx.objectStore(s).index(i).count(faixa(v))),
      limpar: async (s) => {
        await promessa(tx.objectStore(s).clear());
      },
    };
    let resultado: T;
    try {
      resultado = await fn(t);
    } catch (e) {
      try {
        tx.abort();
      } catch {
        /* já finalizada */
      }
      await concluida.catch(() => undefined);
      throw e;
    }
    await concluida;
    return resultado;
  }

  ler<T>(store: NomeStore, chave: IDBValidKey) {
    return this.transacao([store], "readonly", (t) => t.get<T>(store, chave));
  }
  todos<T>(store: NomeStore) {
    return this.transacao([store], "readonly", (t) => t.todos<T>(store));
  }
  porIndice<T>(store: NomeStore, indice: string, valor: IDBValidKey) {
    return this.transacao([store], "readonly", (t) => t.porIndice<T>(store, indice, valor));
  }
  gravar(store: NomeStore, valor: unknown) {
    return this.transacao([store], "readwrite", (t) => t.put(store, valor));
  }
}

/** Lista os bancos V2 existentes no aparelho (para limpeza/diagnóstico). */
export async function bancosV2(fabrica: IDBFactory = indexedDB): Promise<string[]> {
  if (typeof fabrica.databases !== "function") return [];
  const lista = await fabrica.databases();
  return lista.map((d) => d.name ?? "").filter((n) => n.startsWith("cr-v2:"));
}

export function apagarBanco(nome: string, fabrica: IDBFactory = indexedDB): Promise<void> {
  return new Promise((ok, erro) => {
    const req = fabrica.deleteDatabase(nome);
    req.onsuccess = () => ok();
    req.onerror = () => erro(req.error);
    req.onblocked = () => ok();
  });
}
