import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Relatorios } from "@/components/admin/Relatorios";
import { RelatoriosAgendados } from "@/components/admin/RelatoriosAgendados";

/** Módulo Relatórios: geração manual (Fase 2) e agendamento automático (Fase 4). */
export function RelatoriosModulo() {
  return (
    <Tabs defaultValue="manual">
      <TabsList className="flex w-full flex-wrap">
        <TabsTrigger value="manual">Gerar relatório</TabsTrigger>
        <TabsTrigger value="agendados">Relatórios agendados</TabsTrigger>
      </TabsList>
      <TabsContent value="manual" className="pt-4">
        <Relatorios />
      </TabsContent>
      <TabsContent value="agendados" className="pt-4">
        <RelatoriosAgendados />
      </TabsContent>
    </Tabs>
  );
}
