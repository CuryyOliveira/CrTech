/**
 * Dono do cache offline da V1 neste aparelho.
 *
 * O cache da V1 é único por aparelho. Quando OUTRO usuário entra (online ou offline), o cache
 * e o contexto de acesso do anterior são apagados antes de qualquer tela ler dados — assim B
 * nunca vê listas/conferências de A. O mesmo usuário que sai e volta (inclusive sem internet)
 * mantém o seu cache. A fila de pendências NÃO é apagada: cada operação guarda o usuário que a
 * fez e só é enviada com a sessão desse mesmo usuário (ver sync.ts).
 */
import { esquecerAcesso } from "./contexto";
import { limparCacheLocal } from "./idb";

const DONO = "cr:cache-dono";

export async function prepararCacheParaUsuario(userId: string) {
  try {
    const anterior = localStorage.getItem(DONO);
    if (anterior && anterior !== userId) {
      await limparCacheLocal();
      esquecerAcesso();
    }
    localStorage.setItem(DONO, userId);
  } catch {
    /* armazenamento indisponível: nada a limpar */
  }
}
