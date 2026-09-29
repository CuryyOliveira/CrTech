/**
 * Estado da tela de conferência V2, lido do motor V2 (IndexedDB do usuário). A tela não guarda
 * cópia própria das regras: tudo o que muda passa por MotorSync e volta para cá pelo aviso
 * `aoAlterarDados`.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { ordenarItens, problemasPorItem, resumir } from "@/lib/conferencia-v2/apresentacao";
import type { MotorSync } from "@/lib/sync-v2";
import {
  ErroRegra,
  type ConferenciaLocal,
  type FotoLocal,
  type ItemFila,
  type ItemLocal,
} from "@/lib/sync-v2/tipos";

export type DadosConferencia = {
  conferencia: ConferenciaLocal | null;
  itens: ItemLocal[];
  fila: ItemFila[];
  fotos: FotoLocal[];
  carregado: boolean;
};

const VAZIO: DadosConferencia = {
  conferencia: null,
  itens: [],
  fila: [],
  fotos: [],
  carregado: false,
};

export function useConferenciaV2(motor: MotorSync, conferenciaId: string) {
  const [dados, setDados] = useState<DadosConferencia>(VAZIO);
  const leitura = useRef(0);

  const carregar = useCallback(async () => {
    const n = ++leitura.current;
    const [conferencia, itens, fila, fotos] = await Promise.all([
      motor.conferencia(conferenciaId),
      motor.itens(conferenciaId),
      motor.filaDaConferencia(conferenciaId),
      motor.fotos(conferenciaId),
    ]);
    if (n !== leitura.current) return; // chegou uma leitura mais nova
    setDados({
      conferencia: conferencia ?? null,
      itens: ordenarItens(itens),
      fila,
      fotos,
      carregado: true,
    });
  }, [motor, conferenciaId]);

  useEffect(() => {
    void carregar();
    return motor.aoAlterarDados(() => void carregar());
  }, [motor, carregar]);

  const problemas = useMemo(() => problemasPorItem(dados.fila), [dados.fila]);
  const resumo = useMemo(() => resumir(dados.itens, problemas), [dados.itens, problemas]);
  const aguardandoSync = useMemo(
    () => dados.fila.filter((f) => f.status !== "SYNCED" && f.status !== "RESOLVED").length,
    [dados.fila],
  );

  return { ...dados, problemas, resumo, aguardandoSync, recarregar: carregar };
}

/** Executa uma ação do motor mostrando a mensagem de regra (se houver) sem derrubar a tela. */
export async function executar<T>(acao: () => Promise<T>, sucesso?: string): Promise<T | null> {
  try {
    const r = await acao();
    if (sucesso) toast.success(sucesso);
    return r;
  } catch (e) {
    toast.error(e instanceof ErroRegra || e instanceof Error ? e.message : String(e));
    return null;
  }
}
