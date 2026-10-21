/** Central Administrativa: grupos e módulos (reorganização só de navegação). */
import { describe, expect, it } from "vitest";
import {
  ADMIN_CATEGORIAS,
  ADMIN_ITENS,
  adminCategoria,
  adminItem,
  categoriaDoItem,
} from "@/lib/admin";

describe("grupos da Central Administrativa", () => {
  it("mantém os mesmos 21 módulos, cada um em exatamente um grupo", () => {
    expect(ADMIN_ITENS).toHaveLength(21);
    const slugs = ADMIN_ITENS.map((i) => i.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const s of slugs) {
      expect(ADMIN_CATEGORIAS.filter((c) => c.itens.some((i) => i.slug === s))).toHaveLength(1);
      expect(adminItem(s)?.slug).toBe(s);
    }
  });

  it("três grupos existentes, com descrição, acessíveis pela tela própria", () => {
    expect(ADMIN_CATEGORIAS.map((c) => c.id)).toEqual(["gestao", "inteligencia", "controle"]);
    for (const c of ADMIN_CATEGORIAS) {
      expect(c.descricao.length).toBeGreaterThan(10);
      expect(adminCategoria(c.id)).toBe(c);
    }
    expect(adminCategoria("inexistente")).toBeUndefined();
  });

  it("trilha Central → Grupo → Módulo", () => {
    expect(categoriaDoItem("usuarios")?.id).toBe("gestao");
    expect(categoriaDoItem("painel-gerencial")?.id).toBe("inteligencia");
    expect(categoriaDoItem("auditoria")?.id).toBe("controle");
    expect(categoriaDoItem("nao-existe")).toBeUndefined();
  });

  it("'grupo' não colide com nenhum módulo (rota /admin/grupo/$grupo)", () => {
    expect(adminItem("grupo")).toBeUndefined();
  });
});
