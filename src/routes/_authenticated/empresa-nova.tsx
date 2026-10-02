import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ArrowLeft, Building2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { criarMinhaEmpresa } from "@/lib/empresa.functions";
import { IconeModulo } from "@/components/IconeModulo";
import { SEGMENTOS, getSegmento } from "@/lib/modulos";
import { setoresSugeridos } from "@/lib/setores";
import { Plus, X } from "lucide-react";

export const Route = createFileRoute("/_authenticated/empresa-nova")({
  head: () => ({
    meta: [
      { title: "Cadastre sua empresa — Conferência Rápida" },
      {
        name: "description",
        content:
          "Cadastre a sua empresa no Conferência Rápida: nome, CNPJ e contato para liberar o teste de 14 dias.",
      },
      { property: "og:title", content: "Cadastre sua empresa — Conferência Rápida" },
      {
        property: "og:description",
        content: "Informe os dados da empresa para liberar o teste gratuito de 14 dias.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: EmpresaNova,
});

/** FASE 3 — Cadastro da empresa; quem cadastra vira proprietário + administrador. */
function EmpresaNova() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const criar = useServerFn(criarMinhaEmpresa);
  const [form, setForm] = useState({
    nome: "",
    cnpj: "",
    email: "",
    telefone: "",
    observacoes: "",
  });
  const [salvando, setSalvando] = useState(false);
  // FASE 13 — segmento sugere os módulos iniciais, sem limitar o administrador.
  const [segmento, setSegmento] = useState<string>("");
  const [selecionados, setSelecionados] = useState<string[]>([]);
  const sugeridos = getSegmento(segmento)?.modulos ?? [];
  // Setores da empresa — estrutura organizacional própria de cada cliente.
  const [setores, setSetores] = useState<string[]>([]);
  const [novoSetor, setNovoSetor] = useState("");
  const sugestoesSetor = setoresSugeridos(segmento).filter((s) => !setores.includes(s));

  function adicionarSetor(nome: string) {
    const limpo = nome.trim().slice(0, 60);
    if (limpo.length < 2 || setores.includes(limpo)) return;
    setSetores((atual) => [...atual, limpo]);
    setNovoSetor("");
  }

  function escolherSegmento(valor: string) {
    setSegmento(valor);
    setSelecionados((getSegmento(valor)?.modulos ?? []).map((m) => m.nome));
    setSetores(setoresSugeridos(valor));
  }

  function alternarModulo(nome: string) {
    setSelecionados((atual) =>
      atual.includes(nome) ? atual.filter((n) => n !== nome) : [...atual, nome],
    );
  }

  const alterar = (campo: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [campo]: e.target.value }));

  async function enviar() {
    setSalvando(true);
    try {
      await criar({
        data: {
          ...form,
          segmento: segmento || null,
          modulos: sugeridos.filter((m) => selecionados.includes(m.nome)),
          setores: setores.map((nome) => ({ nome })),
        },
      });
      await queryClient.invalidateQueries();
      toast.success("Empresa cadastrada", {
        description: "Agora escolha o plano e ative seu teste de 14 dias.",
      });
      navigate({ to: "/planos" });
    } catch (e) {
      toast.error("Não foi possível cadastrar a empresa", {
        description: e instanceof Error ? e.message : "Tente novamente.",
      });
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="flex min-h-screen items-start justify-center bg-background p-4">
      <div className="w-full max-w-lg space-y-3 py-6">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/bem-vindo" aria-label="Voltar para a tela de boas-vindas">
            <ArrowLeft className="size-4" /> Voltar
          </Link>
        </Button>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Building2 className="size-4 text-primary" /> Cadastre sua empresa
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              A assinatura pertence à empresa. Você será o proprietário e administrador dela,
              podendo convidar sua equipe depois.
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="nome">Nome da empresa *</Label>
              <Input
                id="nome"
                value={form.nome}
                onChange={alterar("nome")}
                maxLength={120}
                placeholder="Razão social ou nome fantasia"
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="cnpj">CNPJ</Label>
                <Input
                  id="cnpj"
                  value={form.cnpj}
                  onChange={alterar("cnpj")}
                  maxLength={18}
                  inputMode="numeric"
                  placeholder="00.000.000/0000-00"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="telefone">Telefone</Label>
                <Input
                  id="telefone"
                  value={form.telefone}
                  onChange={alterar("telefone")}
                  maxLength={20}
                  inputMode="tel"
                  placeholder="(00) 00000-0000"
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="email">E-mail empresarial</Label>
              <Input
                id="email"
                type="email"
                value={form.email}
                onChange={alterar("email")}
                maxLength={255}
                placeholder="contato@suaempresa.com.br"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="observacoes">Observações</Label>
              <Textarea
                id="observacoes"
                value={form.observacoes}
                onChange={alterar("observacoes")}
                maxLength={500}
                placeholder="Informações úteis sobre a operação (opcional)"
              />
            </div>

            <div className="space-y-2 rounded-xl border bg-muted/30 p-3">
              <Label>Segmento da empresa</Label>
              <p className="text-xs text-muted-foreground">
                Usamos o segmento apenas para sugerir os módulos iniciais. Você pode criar,
                renomear ou remover módulos depois.
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                {SEGMENTOS.map((s) => (
                  <button
                    key={s.valor}
                    type="button"
                    onClick={() => escolherSegmento(s.valor)}
                    className={`rounded-lg border p-2 text-left transition-colors ${
                      segmento === s.valor
                        ? "border-primary bg-primary/10"
                        : "hover:border-primary/50"
                    }`}
                  >
                    <p className="text-sm font-semibold">{s.nome}</p>
                    <p className="text-xs text-muted-foreground">{s.descricao}</p>
                  </button>
                ))}
              </div>

              {sugeridos.length > 0 && (
                <div className="space-y-2 pt-2">
                  <Label>Módulos sugeridos</Label>
                  <div className="flex flex-wrap gap-2">
                    {sugeridos.map((m) => {
                      const ativo = selecionados.includes(m.nome);
                      return (
                        <button
                          key={m.nome}
                          type="button"
                          onClick={() => alternarModulo(m.nome)}
                          className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs transition-colors ${
                            ativo
                              ? "border-primary bg-primary/10 text-primary"
                              : "text-muted-foreground hover:border-primary/50"
                          }`}
                        >
                          <IconeModulo nome={m.icone} className="size-3.5" /> {m.nome}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-2 rounded-xl border bg-muted/30 p-3">
              <Label>Configure os setores da sua empresa</Label>
              <p className="text-xs text-muted-foreground">
                Crie os setores que fazem parte da sua operação. Você pode ajustá-los depois na
                Central Administrativa.
              </p>
              <div className="flex gap-2">
                <Input
                  value={novoSetor}
                  maxLength={60}
                  placeholder="Ex.: Almoxarifado"
                  onChange={(e) => setNovoSetor(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      adicionarSetor(novoSetor);
                    }
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => adicionarSetor(novoSetor)}
                  disabled={novoSetor.trim().length < 2}
                >
                  <Plus className="size-4" /> Adicionar setor
                </Button>
              </div>

              {setores.length > 0 && (
                <div className="flex flex-wrap gap-2 pt-1">
                  {setores.map((s) => (
                    <span
                      key={s}
                      className="flex items-center gap-1 rounded-full border border-primary bg-primary/10 px-3 py-1.5 text-xs text-primary"
                    >
                      {s}
                      <button
                        type="button"
                        aria-label={`Remover setor ${s}`}
                        onClick={() => setSetores((atual) => atual.filter((n) => n !== s))}
                      >
                        <X className="size-3.5" />
                      </button>
                    </span>
                  ))}
                </div>
              )}

              {sugestoesSetor.length > 0 && (
                <div className="flex flex-wrap gap-2 pt-1">
                  {sugestoesSetor.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => adicionarSetor(s)}
                      className="rounded-full border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary/50"
                    >
                      + {s}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <Button
              className="w-full"
              size="lg"
              onClick={() => void enviar()}
              disabled={salvando || form.nome.trim().length < 2}
            >
              {salvando ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Building2 className="size-4" />
              )}
              Cadastrar empresa e escolher plano
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
