import { memo } from "react";
import type { Resumo } from "@/lib/conferencia-v2/apresentacao";

/** "125 / 480" + conferidos, pendentes, divergências (atualiza a cada contagem). */
export const ConferenceProgress = memo(function ConferenceProgress({ resumo }: { resumo: Resumo }) {
  return (
    <section aria-label="Progresso da conferência" className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-2xl font-bold tabular-nums" aria-live="polite" data-testid="progresso">
          {resumo.feitos} / {resumo.total}
        </p>
        <p className="text-sm font-semibold tabular-nums text-muted-foreground">{resumo.pct}%</p>
      </div>
      <div
        className="h-2.5 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={resumo.total}
        aria-valuenow={resumo.feitos}
        aria-label={`${resumo.feitos} de ${resumo.total} itens conferidos`}
      >
        <div
          className="h-full rounded-full bg-primary transition-[width]"
          style={{ width: `${resumo.pct}%` }}
        />
      </div>
      <dl className="grid grid-cols-3 gap-2 text-center text-xs">
        <div className="rounded-md bg-emerald-500/10 py-1">
          <dt className="text-muted-foreground">Conferidos</dt>
          <dd className="text-base font-bold tabular-nums" data-testid="qtd-conferidos">
            {resumo.conferidos}
          </dd>
        </div>
        <div className="rounded-md bg-muted py-1">
          <dt className="text-muted-foreground">Pendentes</dt>
          <dd className="text-base font-bold tabular-nums" data-testid="qtd-pendentes">
            {resumo.pendentes}
          </dd>
        </div>
        <div className="rounded-md bg-amber-500/10 py-1">
          <dt className="text-muted-foreground">Divergências</dt>
          <dd className="text-base font-bold tabular-nums" data-testid="qtd-divergencias">
            {resumo.divergencias}
          </dd>
        </div>
      </dl>
    </section>
  );
});
