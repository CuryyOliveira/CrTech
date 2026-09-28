import { createFileRoute } from "@tanstack/react-router";
import { PaginaPublica } from "@/components/publico/RodapeLegal";

const TITULO = "Política de Reembolso — C.R Tech";
const DESCRICAO =
  "Regras de reembolso e cancelamento das assinaturas do Conferência Rápida, incluindo o direito de arrependimento de 7 dias.";

export const Route = createFileRoute("/reembolso")({
  head: () => ({
    meta: [
      { title: TITULO },
      { name: "description", content: DESCRICAO },
      { property: "og:title", content: TITULO },
      { property: "og:description", content: DESCRICAO },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Reembolso,
});

function Reembolso() {
  return (
    <PaginaPublica titulo="Política de Reembolso" atualizado="11 de agosto de 2026">
      <p>
        Esta política se aplica às assinaturas do Conferência Rápida contratadas junto à{" "}
        <strong>C.R Tech</strong>.
      </p>

      <h2>1. Teste grátis</h2>
      <p>
        Toda nova empresa tem 14 dias de teste grátis. Se o cancelamento ocorrer durante esse
        período, nenhuma cobrança é realizada.
      </p>

      <h2>2. Garantia de 30 dias</h2>
      <p>
        A C.R Tech oferece garantia de satisfação de 30 dias. Se você não estiver satisfeito com
        a compra, pode solicitar o reembolso integral em até 30 dias corridos a partir da data do
        pedido, sem necessidade de justificativa. Esse prazo é somado ao direito de arrependimento de
        7 dias previsto no art. 49 do Código de Defesa do Consumidor.
      </p>

      <h2>3. Outras situações</h2>
      <ul>
        <li>
          Assinaturas mensais e anuais: o cancelamento encerra as renovações futuras e o acesso
          permanece até o fim do período já pago.
        </li>
        <li>
          Assinaturas anuais: além da garantia de 30 dias, avaliamos o reembolso proporcional aos
          meses integrais ainda não utilizados.
        </li>
        <li>
          Cobranças duplicadas, valores incorretos ou indisponibilidade prolongada por falha nossa são
          reembolsados integralmente.
        </li>
      </ul>

      <h2>4. Como solicitar</h2>
      <p>
        A C.R Tech é a vendedora e responsável pelo atendimento e pelas devoluções. Para solicitar o
        reembolso, escreva para contato@conferenciarapida.com.br com o e-mail utilizado na compra, o
        nome da empresa e o motivo (opcional). Você também pode cancelar a renovação a qualquer
        momento na área "Minha assinatura" dentro do sistema — nesse caso o acesso permanece até o
        fim do período já pago.
      </p>

      <h2>5. Prazos</h2>
      <p>
        A solicitação é analisada em até 5 dias úteis. Aprovado o reembolso, o valor é devolvido pelo
        Mercado Pago, nosso provedor de pagamentos, pelo mesmo meio utilizado na compra em até 10
        dias úteis; o prazo de crédito na fatura depende do banco emissor.
      </p>


      <h2>6. Dados após o cancelamento</h2>
      <p>
        Os dados da empresa permanecem disponíveis para exportação por 30 dias após o encerramento e
        podem ser excluídos definitivamente a pedido do cliente.
      </p>
    </PaginaPublica>
  );
}
