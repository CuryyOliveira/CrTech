#!/usr/bin/env python3
"""
Compara dois catálogos (JSON de consultas_catalogo.sql) e lista as diferenças.

Uso: python3 comparar_catalogo.py producao.json teste.json
Sai com código 1 se houver diferença estrutural.

Diferenças esperadas e ignoradas (documentadas em docs/DATABASE_BASELINE.md):
  * privilégio MAINTAIN (só existe no Postgres 17; o teste local pode ser 16);
  * ACL de schema (o dono do schema public difere entre plataforma e banco local).
"""
import json
import re
import sys


def carregar(caminho: str) -> dict:
    d = json.load(open(caminho, encoding="utf-8"))
    if isinstance(d, list):  # saída crua do psql/MCP
        d = d[0]
    return d.get("catalogo", d)


def linhas(texto: str | None) -> list[str]:
    return [l for l in (texto or "").splitlines() if l.strip()]


def normalizar_grant(g: str) -> str:
    tabela, papel, privs = g.split("|")
    return f"{tabela}|{papel}|{','.join(p for p in privs.split(',') if p != 'MAINTAIN')}"


def main() -> None:
    a, b = carregar(sys.argv[1]), carregar(sys.argv[2])
    diferencas: list[str] = []

    def comparar(nome: str, x: list[str], y: list[str]) -> None:
        sx, sy = set(x), set(y)
        for item in sorted(sx - sy):
            diferencas.append(f"[{nome}] só na produção: {item[:200]}")
        for item in sorted(sy - sx):
            diferencas.append(f"[{nome}] só no teste:    {item[:200]}")

    for chave in ("tabelas", "restricoes", "fks", "indices", "replica"):
        comparar(chave, linhas(a["parte1"].get(chave)), linhas(b["parte1"].get(chave)))

    fa = {f["nome"]: f for f in a["funcoes"]}
    fb = {f["nome"]: f for f in b["funcoes"]}
    comparar("funcoes", list(fa), list(fb))
    for nome in sorted(set(fa) & set(fb)):
        if fa[nome]["def"] != fb[nome]["def"]:
            diferencas.append(f"[funcoes] definição diferente: {nome}")
        acl_a = set(re.findall(r"(\w*)=X", fa[nome]["acl"])) or {"<padrão>"}
        acl_b = set(re.findall(r"(\w*)=X", fb[nome]["acl"])) or {"<padrão>"}
        if acl_a != acl_b:
            diferencas.append(f"[funcoes] ACL diferente: {nome}: {sorted(acl_a)} x {sorted(acl_b)}")

    p3a, p3b = a["parte3"], b["parte3"]
    for chave in ("triggers_baseline_v2", "rls", "policies"):
        comparar(chave, p3a.get(chave) or [], p3b.get(chave) or [])
    comparar("grants", [normalizar_grant(g) for g in p3a.get("tabela_grants") or []],
             [normalizar_grant(g) for g in p3b.get("tabela_grants") or []])

    if diferencas:
        print("\n".join(diferencas))
        print(f"\n{len(diferencas)} diferença(s).")
        sys.exit(1)
    print("Catálogos idênticos (tabelas, colunas, restrições, índices, funções, ACLs, triggers, RLS, policies, grants).")


if __name__ == "__main__":
    main()
