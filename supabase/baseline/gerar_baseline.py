#!/usr/bin/env python3
"""
Gera a migration de baseline a partir do catálogo REAL do banco de produção.

Entrada: um JSON com as três partes lidas (somente leitura) do catálogo do Postgres
com as consultas de `supabase/baseline/consultas_catalogo.sql`:
  tabelas/restrições/FKs/índices, funções (definição + ACL) e
  triggers/RLS/policies/grants/publicação.

Saída: SQL determinístico que recria exatamente o schema `public` + `app_private`
(sem dados). Uso:

  python3 supabase/baseline/gerar_baseline.py catalogo.json > supabase/migrations/<versão>_baseline_v2.sql
"""
import json
import re
import sys

PRIV_COMPLETOS = {"DELETE", "INSERT", "MAINTAIN", "REFERENCES", "SELECT", "TRIGGER", "TRUNCATE", "UPDATE"}
PAPEIS_API = ("anon", "authenticated", "service_role")


def secao(titulo: str) -> str:
    return f"\n-- {'=' * 76}\n-- {titulo}\n-- {'=' * 76}\n"


def grants_tabelas(linhas: list[str]) -> str:
    """Revoga os privilégios padrão da plataforma e reaplica exatamente os de produção."""
    por_tabela: dict[str, list[tuple[str, set[str]]]] = {}
    for linha in linhas:
        tabela, papel, privs = linha.split("|")
        por_tabela.setdefault(tabela, []).append((papel, set(privs.split(","))))
    out = []
    for tabela in sorted(por_tabela):
        out.append(f"REVOKE ALL ON TABLE {tabela} FROM PUBLIC, {', '.join(PAPEIS_API)};")
        for papel, privs in sorted(por_tabela[tabela]):
            if privs == PRIV_COMPLETOS:
                out.append(f"GRANT ALL ON TABLE {tabela} TO {papel};")
                continue
            comuns = sorted(privs - {"MAINTAIN"})
            if comuns:
                out.append(f"GRANT {', '.join(comuns)} ON TABLE {tabela} TO {papel};")
            if "MAINTAIN" in privs:
                # MAINTAIN só existe a partir do Postgres 17 (produção); ignorado em versões anteriores.
                out.append(
                    "DO $$ BEGIN IF current_setting('server_version_num')::int >= 170000 THEN "
                    f"EXECUTE 'GRANT MAINTAIN ON TABLE {tabela} TO {papel}'; END IF; END $$;"
                )
    # Tabelas sem nenhuma linha de grant para os papéis da API também precisam do REVOKE.
    return "\n".join(out)


def acl_funcoes(funcoes: list[dict]) -> str:
    out = []
    for f in funcoes:
        assinatura = f["nome"]
        nome, args = assinatura.split("(", 1)
        # Assinatura só com tipos (sem nomes/defaults) para GRANT/REVOKE.
        tipos = []
        for arg in args.rstrip(")").split(","):
            arg = arg.strip()
            if not arg:
                continue
            partes = arg.split()
            tipos.append(" ".join(partes[1:]) if len(partes) > 1 else partes[0])
        ref = f"{nome}({', '.join(tipos)})"
        acl = f["acl"]
        if not acl:
            continue  # ACL nula = padrão do Postgres (EXECUTE para PUBLIC), igual à produção
        out.append(f"REVOKE ALL ON FUNCTION {ref} FROM PUBLIC, {', '.join(PAPEIS_API)};")
        for entrada in acl.strip("{}").split(","):
            papel, resto = entrada.split("=", 1)
            privs, _dono = resto.split("/", 1)
            if "X" not in privs or papel == f["owner"]:
                continue
            out.append(f"GRANT EXECUTE ON FUNCTION {ref} TO {papel or 'PUBLIC'};")
    return "\n".join(out)


def main() -> None:
    dados = json.load(open(sys.argv[1], encoding="utf-8"))
    p1, funcoes, p3 = dados["parte1"], dados["funcoes"], dados["parte3"]

    sql: list[str] = []
    sql.append(
        "-- BASELINE V2 — schema real de produção em 29/09/2026 (Postgres 17.6, Supabase).\n"
        "-- Gerado por supabase/baseline/gerar_baseline.py a partir do catálogo (somente leitura).\n"
        "-- NÃO executar em produção: lá este schema já existe. Em produção esta versão é\n"
        "-- apenas MARCADA como aplicada (ver docs/DATABASE_BASELINE.md).\n"
        "-- Não contém dados nem segredos (app_private.hook_secrets vai vazia; o agendamento\n"
        "-- do monitor é recriado com um segredo aleatório gerado no próprio banco).\n"
    )
    sql.append("SET check_function_bodies = false;\nSET client_min_messages = warning;\n"
               "SET search_path = public, extensions;\n")

    sql.append(secao("Schemas e extensões"))
    sql.append(
        "CREATE SCHEMA IF NOT EXISTS app_private;\nCREATE SCHEMA IF NOT EXISTS extensions;\n"
        "CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;\n"
        'CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;\n'
        "CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;\n"
        "-- pg_cron / pg_net só existem na plataforma Supabase: criados apenas se disponíveis.\n"
        "DO $$ BEGIN\n"
        "  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') THEN\n"
        "    CREATE EXTENSION IF NOT EXISTS pg_cron;\n  END IF;\n"
        "  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_net') THEN\n"
        "    CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;\n  END IF;\nEND $$;\n"
    )

    sql.append(secao("Tipos"))
    sql.append("CREATE TYPE public.app_role AS ENUM ('admin', 'conferente', 'visualizador');\n")

    sql.append(secao("Tabelas"))
    sql.append(p1["tabelas"] + "\n")

    sql.append(secao("Chaves primárias, únicas e CHECK"))
    sql.append(p1["restricoes"] + "\n")

    sql.append(secao("Funções"))
    for f in funcoes:
        sql.append(f["def"].rstrip() + ";\n")

    sql.append(secao("Chaves estrangeiras"))
    sql.append(p1["fks"] + "\n")

    sql.append(secao("Índices"))
    sql.append(p1["indices"] + "\n")
    sql.append(p1["replica"] + "\n")

    sql.append(secao("Triggers"))
    sql.append("\n".join(p3["triggers_baseline_v2"]) + "\n")

    sql.append(secao("Row Level Security"))
    sql.append("\n".join(p3["rls"]) + "\n")

    sql.append(secao("Policies"))
    sql.append("\n\n".join(p3["policies"]) + "\n")

    sql.append(secao("Privilégios de schema, tabelas e funções"))
    sql.append(
        "GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;\n"
        "REVOKE ALL ON SCHEMA app_private FROM PUBLIC;\n"
        "GRANT USAGE ON SCHEMA app_private TO authenticated, service_role;\n"
    )
    sql.append(grants_tabelas(p3["tabela_grants"]) + "\n")
    sql.append(acl_funcoes(funcoes) + "\n")

    sql.append(secao("Realtime"))
    tabelas_rt = ["conferencias", "conferencia_itens", "historico_conferencias", "notificacoes_conferencia"]
    sql.append(
        "DO $$ BEGIN\n"
        "  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN\n"
        "    CREATE PUBLICATION supabase_realtime;\n  END IF;\nEND $$;\n"
        + "".join(
            "DO $$ BEGIN\n"
            f"  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = '{t}') THEN\n"
            f"    ALTER PUBLICATION supabase_realtime ADD TABLE public.{t};\n  END IF;\nEND $$;\n"
            for t in tabelas_rt
        )
    )

    sql.append(secao("Agendamento do monitor de conferências (somente onde pg_cron/pg_net existem)"))
    sql.append(
        "INSERT INTO app_private.hook_secrets (nome, valor)\n"
        "VALUES ('monitor_conferencias', encode(extensions.gen_random_bytes(32), 'hex'))\n"
        "ON CONFLICT (nome) DO NOTHING;\n"
        "DO $$\nDECLARE v text;\nBEGIN\n"
        "  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')\n"
        "     OR NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN\n"
        "    RETURN;\n  END IF;\n"
        "  SELECT valor INTO v FROM app_private.hook_secrets WHERE nome = 'monitor_conferencias';\n"
        "  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'monitor-conferencias';\n"
        "  PERFORM cron.schedule('monitor-conferencias', '*/5 * * * *', format($f$\n"
        "  select net.http_post(\n"
        "    url:='https://conferenciarapida.com.br/api/public/hooks/monitor-conferencias',\n"
        "    headers:='{\"Content-Type\": \"application/json\", \"x-hook-secret\": \"%s\"}'::jsonb,\n"
        "    body:='{}'::jsonb\n  ) as request_id;\n$f$, v));\nEND $$;\n"
    )

    texto = "\n".join(sql)
    # Nunca deixar escapar um segredo por engano.
    assert not re.search(r"[0-9a-f]{64}", texto), "possível segredo no baseline"
    sys.stdout.write(texto)


if __name__ == "__main__":
    main()
