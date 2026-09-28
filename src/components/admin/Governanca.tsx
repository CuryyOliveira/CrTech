import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Crown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { SkeletonLista } from "@/components/admin/ui-admin";
import { dadosGovernanca } from "@/lib/admin-users.functions";
import { fmtDateTime } from "@/lib/app";
import { NIVEIS } from "@/lib/permissions";

type Governanca = {
  user_id: string;
  nome: string | null;
  setor: string | null;
  bloqueado: boolean;
  email: string;
  criado_em: string;
  ultimo_login: string | null;
  ultimo_acesso: string | null;
  ultima_alteracao: { acao: string; detalhe: string | null; created_at: string } | null;
} | null;

/** Seção de Governança: identidade e status do Proprietário do Sistema. */
export function Governanca() {
  const carregar = useServerFn(dadosGovernanca);
  const { data, isLoading } = useQuery({
    queryKey: ["governanca"],
    queryFn: () => carregar() as Promise<Governanca>,
  });

  if (isLoading) return <SkeletonLista linhas={2} />;

  return (
    <div className="space-y-3">
      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge className="bg-amber-500 text-black hover:bg-amber-500">
              <Crown className="mr-1 size-3.5" /> PROPRIETÁRIO DO SISTEMA
            </Badge>
            {data?.bloqueado ? (
              <Badge variant="destructive">Conta bloqueada</Badge>
            ) : (
              <Badge className="bg-emerald-600 text-white hover:bg-emerald-600">Conta ativa</Badge>
            )}
          </div>
          {!data ? (
            <p className="text-sm text-muted-foreground">
              Nenhum Proprietário do Sistema definido.
            </p>
          ) : (
            <dl className="grid gap-3 sm:grid-cols-2">
              <Info titulo="Nome" valor={data.nome ?? "—"} />
              <Info titulo="E-mail" valor={data.email || "—"} />
              <Info titulo="Conta criada em" valor={fmtDateTime(data.criado_em)} />
              <Info
                titulo="Último acesso"
                valor={fmtDateTime(data.ultimo_acesso ?? data.ultimo_login)}
              />
              <Info titulo="Setor" valor={data.setor ?? "—"} />
              <Info
                titulo="Última alteração realizada"
                valor={
                  data.ultima_alteracao
                    ? `${data.ultima_alteracao.acao} · ${fmtDateTime(data.ultima_alteracao.created_at)}`
                    : "—"
                }
              />
            </dl>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-2 p-4">
          <p className="font-semibold">Hierarquia de acesso</p>
          <p className="text-sm text-muted-foreground">
            Cada nível herda as permissões do nível inferior. Os perfis operacionais Agrícola e
            Indústria atuam no nível Conferente.
          </p>
          <ol className="space-y-1 text-sm">
            {NIVEIS.map((n) => (
              <li key={n.nivel} className="flex items-center gap-2">
                <span className="w-6 text-muted-foreground">{5 - n.nivel}.</span>
                <span className="font-medium">{n.label}</span>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-1 p-4 text-sm text-muted-foreground">
          <p className="font-semibold text-foreground">Proteções do Proprietário</p>
          <p>
            Administradores não podem alterar permissões, senha, setor, e-mail, bloqueio ou exclusão
            da conta do Proprietário, nem promover outro usuário a Proprietário.
          </p>
          <p>
            A transferência da propriedade está disponível apenas para o Proprietário, na Gestão de
            Usuários, com confirmação de senha e registro em auditoria.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function Info({ titulo, valor }: { titulo: string; valor: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{titulo}</dt>
      <dd className="font-medium">{valor}</dd>
    </div>
  );
}
