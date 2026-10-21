import { createFileRoute, Link } from "@tanstack/react-router";
import { AdminShell, EmDesenvolvimento } from "@/components/admin/AdminShell";
import { Button } from "@/components/ui/button";
import { GestaoUsuarios } from "@/components/admin/GestaoUsuarios";
import { Cadastros } from "@/components/admin/Cadastros";
import { CatalogoSistema } from "@/components/admin/CatalogoSistema";
import { SincronizacaoManual } from "@/components/admin/SincronizacaoManual";
import { DadosOffline } from "@/components/admin/DadosOffline";
import { GestaoModulos } from "@/components/admin/GestaoModulos";
import { GestaoSetores } from "@/components/admin/GestaoSetores";
import { AdministracaoSistema } from "@/components/admin/AdministracaoSistema";
import { HistoricoOperacional } from "@/components/admin/HistoricoOperacional";
import { LogAuditoria } from "@/components/admin/LogAuditoria";
import { RelatoriosModulo } from "@/components/admin/RelatoriosModulo";
import { EstoqueModulo } from "@/components/admin/EstoqueModulo";
import { CentralNotificacoes } from "@/components/admin/CentralNotificacoes";
import { PainelGerencial } from "@/components/admin/PainelGerencial";

import { MetasKpis } from "@/components/admin/MetasKpis";
import { AvisosSistema } from "@/components/admin/AvisosSistema";
import { RelatoriosAdministrativos } from "@/components/admin/RelatoriosAdministrativos";
import { Diagnostico } from "@/components/admin/Diagnostico";
import { Assinaturas } from "@/components/admin/Assinaturas";
import { MinhaEmpresa } from "@/components/admin/MinhaEmpresa";
import { StatusPagamentos } from "@/components/admin/StatusPagamentos";

import { adminItem, categoriaDoItem } from "@/lib/admin";

export const Route = createFileRoute("/_authenticated/admin/$secao")({
  component: Secao,
});

function Secao() {
  const { secao } = Route.useParams();
  const item = adminItem(secao);
  const grupo = categoriaDoItem(secao);

  if (!item) {
    return (
      <AdminShell
        titulo="Área não encontrada"
        trilha={[{ label: "Central Administrativa", to: "/admin" }, { label: "Não encontrada" }]}
      >
        <div className="rounded-xl border border-dashed p-10 text-center">
          <p className="text-sm text-muted-foreground">Esta área não existe.</p>
          <Button className="mt-4" asChild>
            <Link to="/admin">Voltar para a Central Administrativa</Link>
          </Button>
        </div>
      </AdminShell>
    );
  }

  return (
    <AdminShell
      titulo={item.titulo}
      descricao={item.descricao}
      trilha={[
        { label: "Central Administrativa", to: "/admin" },
        ...(grupo ? [{ label: grupo.titulo, to: `/admin/grupo/${grupo.id}` }] : []),
        { label: item.titulo },
      ]}
      voltar={
        grupo ? { to: `/admin/grupo/${grupo.id}`, label: `Voltar para ${grupo.titulo}` } : undefined
      }
    >
      {secao === "sincronizacao" ? (
        <SincronizacaoManual />
      ) : secao === "dados-offline" ? (
        <DadosOffline />
      ) : secao === "catalogo" ? (
        <CatalogoSistema />
      ) : secao === "usuarios" ? (
        <GestaoUsuarios />
      ) : secao === "modulos" ? (
        <GestaoModulos />
      ) : secao === "setores" ? (
        <GestaoSetores />
      ) : secao === "cadastros" ? (
        <Cadastros />
      ) : secao === "avisos" ? (
        <AvisosSistema />
      ) : secao === "relatorios-admin" ? (
        <RelatoriosAdministrativos />
      ) : secao === "minha-empresa" ? (
        <MinhaEmpresa />
      ) : secao === "assinaturas" ? (
        <Assinaturas />
      ) : secao === "status-pagamentos" ? (
        <StatusPagamentos />
      ) : secao === "sistema" ? (
        <AdministracaoSistema />
      ) : secao === "historico-operacional" ? (
        <HistoricoOperacional />
      ) : secao === "diagnostico" ? (
        <Diagnostico />
      ) : secao === "auditoria" ? (
        <LogAuditoria />
      ) : secao === "estoque" ? (
        <EstoqueModulo />
      ) : secao === "relatorios" ? (
        <RelatoriosModulo />
      ) : secao === "notificacoes" ? (
        <CentralNotificacoes />
      ) : secao === "painel-gerencial" ? (
        <PainelGerencial />
      ) : secao === "metas" ? (
        <MetasKpis />
      ) : (
        <EmDesenvolvimento nome={item.titulo} />
      )}
    </AdminShell>
  );
}
