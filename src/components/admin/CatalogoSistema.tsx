import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { GestaoPlanos } from "@/components/admin/GestaoPlanos";
import { GestaoModulos } from "@/components/admin/GestaoModulos";
import { Cadastros } from "@/components/admin/Cadastros";

/**
 * Catálogo editável do sistema em um só lugar: planos comercializados,
 * módulos da empresa e categorias (cadastros mestres). Tudo pela tela,
 * sem depender de alteração de código.
 */
export function CatalogoSistema() {
  return (
    <Tabs defaultValue="planos" className="space-y-4">
      <TabsList>
        <TabsTrigger value="planos">Planos</TabsTrigger>
        <TabsTrigger value="modulos">Módulos</TabsTrigger>
        <TabsTrigger value="categorias">Categorias</TabsTrigger>
      </TabsList>

      <TabsContent value="planos">
        <GestaoPlanos />
      </TabsContent>
      <TabsContent value="modulos">
        <GestaoModulos />
      </TabsContent>
      <TabsContent value="categorias">
        <Cadastros />
      </TabsContent>
    </Tabs>
  );
}
