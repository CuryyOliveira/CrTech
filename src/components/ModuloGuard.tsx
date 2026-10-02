import type { ReactNode } from "react";
import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AcessoNegado } from "@/components/AcessoNegado";
import { useAcesso } from "@/hooks/useAcesso";
import { usePermissoes } from "@/hooks/usePermissoes";
import { autorizarModulo } from "@/lib/acesso.functions";
import { useOffline } from "@/hooks/useOffline";
import { MODULOS, moduloPorTipo, type ModuloId } from "@/lib/permissions";

/**
 * Bloqueia o conteúdo quando o acesso não é permitido.
 * A autorização é validada no servidor (perfil → plano → assinatura →
 * permissão), então abrir a URL direta não contorna a regra.
 * Offline: usa apenas o perfil do cofre local, pois não há rede.
 */
export function ModuloGuard({
  modulo,
  tipo,
  permitirSemAssinatura,
  children,
}: {
  modulo?: ModuloId | string;
  tipo?: string | null;
  /**
   * Telas de contratação (planos/assinatura): a falta de assinatura é
   * justamente o motivo de estarem abertas, então não redirecionam nem
   * bloqueiam — caso contrário o cliente novo fica preso em loop.
   */
  permitirSemAssinatura?: boolean;
  children: ReactNode;
}) {
  const offline = useOffline();
  const id = modulo ?? moduloPorTipo(tipo)?.id;
  const navigate = useNavigate();
  const { carregando: carregandoPerfil, pode: podePerfil, modulos: modulosPerfil } = usePermissoes();
  const { carregando, bloqueio, erro } = useAcesso();
  const verificar = useServerFn(autorizarModulo);

  const { data: autorizacao, isLoading: verificando } = useQuery({
    queryKey: ["autorizar-modulo", id],
    queryFn: () => verificar({ data: { modulo: id as string } }),
    enabled: Boolean(id) && !offline,
    staleTime: 60_000,
    retry: 1,
  });

  useEffect(() => {
    if (offline || carregando) return;
    if (bloqueio === "sem_empresa") navigate({ to: "/bem-vindo", replace: true });
    else if (bloqueio === "sem_assinatura" && !permitirSemAssinatura)
      navigate({ to: "/assinatura-necessaria", replace: true });
    else if (bloqueio === "empresa_bloqueada" || bloqueio === "empresa_desativada")
      navigate({ to: "/empresa-bloqueada", replace: true });
  }, [offline, carregando, bloqueio, permitirSemAssinatura, navigate]);

  // Módulo dinâmico (criado pela empresa) não existe na tabela legada de perfis:
  // offline, basta o perfil ter nível operacional com módulos liberados.
  const legado = Boolean(id) && MODULOS.some((m) => m.id === id);
  const liberadoOffline = legado ? podePerfil(id as ModuloId) : modulosPerfil.length > 0;

  if (offline) {
    if (carregandoPerfil) return <div className="min-h-screen bg-background" />;
    return id && liberadoOffline ? <>{children}</> : <AcessoNegado />;
  }

  if (carregando || verificando) return <div className="min-h-screen bg-background" />;
  if (bloqueio && bloqueio !== "usuario_bloqueado") {
    const liberadoParaContratar = permitirSemAssinatura && bloqueio === "sem_assinatura";
    if (!liberadoParaContratar) return <div className="min-h-screen bg-background" />;
  }

  // Falha de rede não deve derrubar o app: cai para a regra de perfil.
  if (erro && !autorizacao) return id && liberadoOffline ? <>{children}</> : <AcessoNegado />;

  // Sem assinatura, o servidor nega tudo. Para as telas de contratação,
  // a permissão do módulo continua sendo decidida pelo servidor (contexto).
  if (
    permitirSemAssinatura &&
    !autorizacao?.permitido &&
    autorizacao?.motivo === "sem_assinatura" &&
    id &&
    (!legado || (autorizacao.contexto?.modulos ?? []).includes(id as ModuloId))
  ) {
    return <>{children}</>;
  }

  if (!autorizacao?.permitido) return <AcessoNegado />;
  return <>{children}</>;
}
