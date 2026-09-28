# Fase 13 — Motor Universal de Módulos (auditoria e arquitetura)

Nenhuma alteração foi feita: banco, rotas, planos, permissões, offline, Central Administrativa e Painel Master permanecem intactos.

## A. Arquitetura atual

Módulos são constantes de código, não dados:

- `src/lib/permissions.ts` define `ModuloId` (FROTA, FERRAMENTAS_AGRICOLA, ESTOQUE_AGRICOLA, FERRAMENTAS_INDUSTRIA, ESTOQUE_INDUSTRIA, ADMIN), `Tipo` (caminhao, caixa, prateleira, caixa_industria, prateleira_industria), `Familia` (comportamento de tela), rota fixa e ícone.
- Cada módulo tem uma rota própria: `frota.tsx`, `ferramentas-agricola.tsx`, `estoque-agricola.tsx`, `ferramentas-industria.tsx`, `estoque-industria.tsx` — todas renderizam `UnidadesPage` com `tipo` fixo.
- O motor de conferência de fato já é único: `UnidadesPage` (listas/unidades) + `unidade.$id.tsx` (~1.600 linhas: importação, itens, cronômetro/pausas, assinatura, divergências, histórico) + `src/lib/app.ts` (Excel, normalização, persistência).
- Permissão = perfil → lista fixa de módulos (`PERMISSOES`), refinada por `permissoes_usuario`/`permissoes_perfil` e pelo plano (`planos.modulos`), consolidada no servidor em `acesso.functions.ts` e aplicada por `ModuloGuard`.
- Dados operacionais escopados por `unidades.tipo` + RLS por usuário; `empresas`/`empresa_usuarios` hoje servem apenas a assinatura/cobrança.

## B. Problemas para módulos dinâmicos

1. Módulo é enum de tipo TypeScript: qualquer módulo novo exige deploy.
2. Rota por módulo (1 arquivo por segmento) — não escala para clientes.
3. `unidades.tipo` faz papel de "módulo" e é um texto livre não normalizado.
4. **Nenhuma tabela operacional tem `empresa_id`**: `unidades`, `materiais`, `material_imagens`, `conferencias`, `conferencia_itens`, `conferencia_pausas`, `historico_conferencias`, `notificacoes_conferencia`, `metas`, `cadastros_mestres`, `avisos_sistema`, `relatorios_agendados`, `auditoria`, `sessoes_usuario`. Isolamento multiempresa hoje é por usuário, não por empresa.
5. `planos.modulos` guarda nomes fixos de módulos legados — acoplamento comercial ao produto.
6. Filtros de UI por módulo em: `Relatorios`, `RelatoriosModulo`, `HistoricoOperacional`, `CentralNotificacoes`, `MetasKpis`, `MatrizPermissoes`, `LogAuditoria`, `RelatoriosAgendados`, `gerencial.ts`, `audit.ts`, `planos.tsx`, `mcp/tools/historico-conferencias.ts`.
7. Offline: cofre, cache e fila não carregam `empresa_id`/`modulo_id` — risco de mistura se o dispositivo trocar de empresa.
8. Onboarding atual (`bem-vindo`, `empresa-nova`, `planos`, `assinatura`) termina na assinatura; não configura estrutura da empresa.

## C. Arquitetura proposta

Cadeia única: **Usuário → Empresa → Segmento/Configuração → Módulos → Permissões → Motor**.

- `empresa_modulos` passa a ser a fonte de verdade dos módulos; módulos legados continuam como registros virtuais em código (`origem: "legado"`).
- Uma rota genérica `/m/$moduloId` (e `/m/$moduloId/$unidadeId`) reutiliza `UnidadesPage`/`unidade.$id` sem duplicação; rotas legadas mantidas como aliases permanentes.
- `familia` vira `tipo` do módulo (`lista` | `caixa` | `frota`), e o comportamento fino vem de `recursos` (JSONB de flags), não de código por cliente.
- `permissions.ts` deixa de exportar enum de módulos e passa a expor helpers sobre módulos resolvidos em runtime; `ModuloGuard` e `autorizarModulo` recebem `moduloId` como string (UUID ou código legado) e validam empresa + plano + permissão no servidor.
- Plano deixa de listar nomes: limites genéricos (`max_usuarios`, `max_modulos`, `recursos`).
- Segmento é só sugestão (catálogo de templates em código/tabela de seeds), nunca restrição.

## D. Estrutura de banco proposta (não criar agora)

- `empresas`: + `segmento text`, `config jsonb`, `onboarding_etapa text`.
- `empresa_modulos`: `id, empresa_id, codigo, nome, descricao, icone, cor, tipo, recursos jsonb, ordem int, ativo bool, excluido bool, origem text ('sugerido'|'personalizado'|'legado'), created_by, created_at, updated_at`; unique `(empresa_id, lower(nome))` e `(empresa_id, codigo)`.
- Opcional `listas_conferencia` (hoje `unidades` cumpre o papel): manter `unidades` e apenas acrescentar `empresa_id` + `modulo_id`.
- Colunas novas em: `unidades`, `materiais`, `conferencias`, `historico_conferencias`, `notificacoes_conferencia`, `metas` → `empresa_id` (NOT NULL após backfill) e `modulo_id` (nullable para legado). Tabelas filhas (`conferencia_itens`, `conferencia_pausas`, `material_imagens`, `notificacao_emails`) herdam escopo pelo pai, mas ganham `empresa_id` denormalizado para RLS simples e barata.
- `permissoes_usuario`/`permissoes_perfil`: + `modulo_id uuid null` (mantendo `modulo text` para legado).
- `planos`: + `max_modulos int`, `recursos jsonb` (já existe) — `modulos` mantido só para leitura legada.
- RLS: toda política operacional passa a exigir `empresa_id IN (SELECT empresas_do_usuario(auth.uid()))` **em conjunto** com as regras atuais; RPCs afetadas: `empresa_do_usuario`, `empresas_do_usuario`, `plano_da_empresa`, `usuarios_ativos_empresa`, `diagnostico_permissoes`, `criar_empresa_onboarding` (+ nova `criar_modulos_iniciais`). GRANTs para `authenticated`/`service_role` em toda tabela nova.

## E. Estratégia de compatibilidade

- Corte de legado (`CORTE_LEGADO`, `usuarios_legados`) permanece: legados nunca entram no onboarding novo nem no gate de assinatura.
- Módulos legados continuam resolvidos por `unidades.tipo`; `modulo_id` fica nulo nesses registros e o motor aceita ambos os caminhos (`tipo` legado OU `modulo_id`).
- Backfill de `empresa_id` só onde há vínculo determinístico; registros legados sem empresa recebem a empresa do proprietário e política de exceção explícita.
- Painel Master, `app_private.eh_master()`, Mercado Pago (live), webhooks e planos: zero alteração; leitura de módulos dinâmicos só numa subfase posterior.
- Central Administrativa preservada: telas passam a listar módulos vindos de uma fonte única (`useModulos`), sem duplicar por segmento.

## F. Plano de implementação (subfases)

- **13A — Fundação de dados**: `empresas.segmento/config`, `empresa_modulos` + GRANTs/RLS, RPC de criação, sem UI. Legado intocado.
- **13B — Isolamento multiempresa**: `empresa_id` nas tabelas operacionais, backfill, RLS reforçada, auditoria de vazamento entre empresas.
- **13C — Motor genérico**: `useModulos`, rota `/m/$moduloId`, `UnidadesPage`/`unidade.$id` orientados por `tipo`+`recursos`, aliases legados mantidos.
- **13D — Permissões dinâmicas**: `modulo_id` em permissões, `ModuloGuard`/`autorizarModulo` por módulo dinâmico, matriz administrativa dinâmica.
- **13E — Onboarding universal**: Bem-vindo → empresa → segmento → sugestão/criação de módulos → revisão → plano → Mercado Pago/trial → conclusão → menu dinâmico (reaproveitando `bem-vindo`, `empresa-nova`, `planos`, `assinatura`).
- **13F — Central, relatórios e notificações dinâmicos**: filtros e cabeçalhos por empresa/módulo/lista; PDF/Excel com empresa + módulo.
- **13G — Offline por empresa/módulo**: chave de cache e fila com `empresa_id`/`modulo_id`, limpeza ao trocar empresa.
- **13H — Planos genéricos + Painel Master**: `max_modulos`/`recursos`, visão Master dos módulos por empresa.

## G. Riscos

- **Perda de dados**: backfill de `empresa_id` incorreto pode ocultar registros por RLS — mitigar com coluna nullable + validação antes do NOT NULL.
- **Mistura entre empresas**: maior risco atual (nenhuma tabela operacional tem escopo empresarial); 13B é pré-requisito de qualquer módulo dinâmico.
- **Regressão offline**: cache local antigo sem `empresa_id` — exigir versionamento do banco local e purga na atualização.
- **Quebra de relatórios/notificações**: dependem de `tipo`/nomes fixos; manter fallback legado durante 13F.
- **Quebra de permissões**: mudança de enum para string dinâmica pode liberar ou negar em excesso — manter `autorizarModulo` fail-closed no servidor e testes por perfil.
- **Legados**: qualquer alteração em `permissions.ts` afeta proprietário e usuários legados; preservar `PERMISSOES` legado como camada intacta.
