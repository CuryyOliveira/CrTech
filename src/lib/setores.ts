/**
 * Setores por empresa.
 *
 * Setor é uma área organizacional da empresa (Farmácia, UTI, Produção...) e
 * não deve ser confundido com módulo (ambiente/processo de conferência).
 *
 * A empresa legada mantém os setores "Agrícola" e "Indústria" — eles vivem em
 * `empresa_setores` com origem `legado` e continuam disponíveis normalmente.
 */

export type SetorEmpresa = {
  id: string;
  empresa_id: string;
  codigo: string;
  nome: string;
  descricao: string | null;
  ordem: number;
  ativo: boolean;
  origem: string;
  created_at: string;
  updated_at: string;
};

/** Setores legados usados como último recurso (offline ou empresa não resolvida). */
export const SETORES_LEGADO = [
  { codigo: "agricola", nome: "Agrícola" },
  { codigo: "industria", nome: "Indústria" },
];

/** Código estável derivado do nome do setor. */
export function codigoSetor(nome: string) {
  return nome
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

/** Sugestões de setores por segmento, apenas para agilizar o onboarding. */
export const SETORES_SUGERIDOS: Record<string, string[]> = {
  farmacia: ["Loja", "Estoque", "Medicamentos Controlados", "Administração"],
  hospital: ["Farmácia", "Centro Cirúrgico", "UTI", "Almoxarifado", "Administração"],
  autopecas: ["Estoque", "Oficina", "Expedição", "Loja"],
  supermercado: ["Loja", "Depósito", "Açougue", "Hortifruti"],
  industria: ["Produção", "Manutenção", "Qualidade", "Expedição", "Almoxarifado"],
  agronegocio: ["Campo", "Oficina", "Almoxarifado", "Administração"],
  construcao: ["Obra", "Almoxarifado", "Equipamentos", "Administração"],
  transportadora: ["Frota", "Oficina", "Expedição", "Administração"],
  restaurante: ["Cozinha", "Salão", "Estoque", "Administração"],
  escola: ["Secretaria", "Almoxarifado", "Manutenção", "Cantina"],
  ti: ["Suporte", "Infraestrutura", "Estoque", "Administração"],
  outro: ["Administração", "Almoxarifado", "Operação"],
};

export function setoresSugeridos(segmento?: string | null) {
  return SETORES_SUGERIDOS[segmento ?? ""] ?? SETORES_SUGERIDOS["outro"] ?? [];
}
