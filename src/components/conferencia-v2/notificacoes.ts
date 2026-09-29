/**
 * Avisos por e-mail/WhatsApp (início e conclusão) das conferências feitas pela tela V2.
 *
 * Reaproveita as funções da V1 (notificacoes-inicio.ts), mas só dispara DEPOIS que o servidor
 * confirmou a conferência (linha do servidor já recebida pelo motor): antes disso a notificação
 * apontaria para uma conferência que ainda não existe lá. Cada aviso sai uma vez por aparelho.
 * Nenhuma fila nova: se a tela não estiver aberta, o aviso sai na próxima vez que o app abrir.
 */
import {
  registrarConclusaoConferencia,
  registrarDivergencias,
  registrarInicioConferencia,
} from "@/lib/notificacoes-inicio";
import { moduloPorTipo } from "@/lib/permissions";
import type { MotorSync } from "@/lib/sync-v2";
import { tempoTrabalhado } from "@/lib/sync-v2/projecao";
import { formatarDuracao } from "@/lib/conferencia-v2/apresentacao";

const chave = (conf: string, tipo: string) => `cr:v2-notif:${conf}:${tipo}`;

function jaEnviado(conf: string, tipo: string) {
  try {
    return localStorage.getItem(chave(conf, tipo)) === "1";
  } catch {
    return true; // sem armazenamento: não arrisca duplicar
  }
}
function marcar(conf: string, tipo: string) {
  try {
    localStorage.setItem(chave(conf, tipo), "1");
  } catch {
    /* ignora */
  }
}

export function vigiarNotificacoes(motor: MotorSync) {
  let rodando = false;
  const verificar = async () => {
    if (rodando) return;
    rodando = true;
    try {
      const [confs, unidades] = await Promise.all([motor.conferencias(), motor.unidades()]);
      for (const c of confs) {
        if (!c.servidor) continue;
        const precisaInicio = !jaEnviado(c.id, "inicio");
        const finalizadaNoServidor = c.servidor.status === "finalizada";
        const precisaFim = finalizadaNoServidor && !jaEnviado(c.id, "fim");
        if (!precisaInicio && !precisaFim) continue;
        const eventos = await motor.eventos(c.id);
        const unidade = unidades.find((u) => u.id === c.unidade_id) ?? {};
        const ctx = {
          conferenciaId: c.id,
          unidadeId: c.unidade_id,
          local: (unidade.nome as string | undefined) ?? null,
          frota: (unidade.frota as string | undefined) ?? null,
          matricula: (unidade.matricula as string | undefined) ?? null,
          conferente: c.conferente,
          modulo: moduloPorTipo(unidade.tipo as string | undefined)?.id ?? null,
          tipoConferencia: (unidade.tipo as string | undefined) ?? null,
        };
        if (precisaInicio) {
          marcar(c.id, "inicio");
          if (eventos.some((e) => e.event_type === "CONFERENCE_CREATED")) {
            void registrarInicioConferencia(ctx);
          }
        }
        if (precisaFim) {
          marcar(c.id, "fim");
          if (!eventos.some((e) => e.event_type === "CONFERENCE_FINALIZED")) continue;
          const itens = await motor.itens(c.id);
          const corretos = itens.filter((i) => i.status === "conferido").length;
          const divergentes = itens.filter((i) => i.status === "divergencia").length;
          const contados = itens.filter((i) => i.quantidade_contada !== null);
          const segundos = tempoTrabalhado(c);
          void registrarConclusaoConferencia(ctx, {
            inicio: new Date(c.hora_inicio).toLocaleString("pt-BR"),
            fim: c.hora_fim ? new Date(c.hora_fim).toLocaleString("pt-BR") : "",
            duracaoSegundos: segundos,
            duracao: formatarDuracao(segundos),
            itens: corretos + divergentes,
            corretos,
            divergentes,
            previstos: itens.length,
            contados: contados.length,
            faltantes: contados.filter((i) => i.quantidade_contada! < i.quantidade_esperada).length,
            sobras: contados.filter((i) => i.quantidade_contada! > i.quantidade_esperada).length,
            percentual: itens.length ? Math.round((corretos / itens.length) * 1000) / 10 : 0,
          });
          void registrarDivergencias(
            ctx,
            itens
              .filter((i) => i.status === "divergencia")
              .map((i) => ({
                codigo: i.codigo,
                descricao: i.descricao,
                esperada: i.quantidade_esperada,
                encontrada: i.quantidade_contada,
              })),
          );
        }
      }
    } catch {
      /* avisos nunca atrapalham a conferência */
    } finally {
      rodando = false;
    }
  };
  void verificar();
  return motor.aoAlterarDados(() => void verificar());
}
