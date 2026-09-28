import { auth, defineMcp } from "@lovable.dev/mcp-js";
import listarUnidades from "./tools/listar-unidades";
import listarConferencias from "./tools/listar-conferencias";
import detalhesConferencia from "./tools/detalhes-conferencia";
import historicoConferencias from "./tools/historico-conferencias";
import meuPerfil from "./tools/meu-perfil";

// O emissor OAuth precisa ser o host direto do backend; o ref do projeto é o
// único valor que sobrevive à publicação sem reescrita.
const projectRef = import.meta.env['VITE_SUPABASE_PROJECT_ID'] ?? "project-ref-unset";

export default defineMcp({
  name: "conferencia-rapida",
  title: "Conferência Rápida",
  version: "0.1.0",
  instructions:
    "Ferramentas do Conferência Rápida (conferência de materiais de oficina). Use `listar_unidades` para achar caminhões, caixas e prateleiras; `listar_conferencias` e `detalhes_conferencia` para acompanhar contagens e divergências; `historico_conferencias` para relatórios por período ou módulo; `meu_perfil` para conferir o nível de acesso. Todas as consultas respeitam o perfil do usuário conectado.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [listarUnidades, listarConferencias, detalhesConferencia, historicoConferencias, meuPerfil],
});
