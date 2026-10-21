import { createFileRoute } from "@tanstack/react-router";
import { PaginaPublica } from "@/components/publico/RodapeLegal";

const TITULO = "Termos de Uso — C.R Tech";
const DESCRICAO =
  "Condições de contratação e uso do sistema Conferência Rápida, oferecido pela C.R Tech por assinatura mensal.";

export const Route = createFileRoute("/termos")({
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
  component: Termos,
});

function Termos() {
  return (
    <PaginaPublica titulo="Termos de Uso" atualizado="11 de agosto de 2026">
      <p>
        Estes termos regem o uso do sistema Conferência Rápida, fornecido pela{" "}
        <strong>C.R Tech</strong>. Ao criar uma conta ou contratar um plano, o cliente declara
        estar de acordo com as condições abaixo.
      </p>

      <h2>1. Serviço</h2>
      <p>
        O Conferência Rápida é um software como serviço (SaaS) para conferência e inventário de
        materiais, ferramentas, estoques e frota, acessado pelo navegador ou pelo aplicativo
        instalável, com funcionamento offline e sincronização automática.
      </p>

      <h2>2. Conta e responsabilidades do cliente</h2>
      <ul>
        <li>As credenciais são pessoais; o cliente é responsável por mantê-las em sigilo.</li>
        <li>
          O administrador da empresa responde pelos usuários que cadastra e pelo respeito ao limite
          de usuários do plano contratado.
        </li>
        <li>
          É proibido usar o serviço para fins ilícitos, tentar burlar controles de acesso, realizar
          engenharia reversa ou revender o acesso sem autorização escrita.
        </li>
        <li>O cliente é responsável pela veracidade dos dados que insere no sistema.</li>
      </ul>

      <h2>3. Planos, cobrança e teste grátis</h2>
      <ul>
        <li>
          A assinatura é por empresa, com renovação automática conforme a periodicidade contratada.
        </li>
        <li>
          Novas empresas contam com 14 dias de teste grátis; a primeira cobrança ocorre ao término do
          período de teste, caso não haja cancelamento.
        </li>
        <li>
          A venda é realizada diretamente pela C.R Tech, responsável pelo contrato, pelo atendimento
          ao cliente e pelas devoluções. O processamento dos pagamentos e da cobrança recorrente é
          feito pelo Mercado Pago, nosso provedor de pagamentos.
        </li>
        <li>
          As condições de pagamento, faturamento, impostos, cancelamento e reembolso seguem estes
          Termos e a nossa{" "}
          <a href="/reembolso">Política de Reembolso</a>. Os dados do cartão são informados
          diretamente no ambiente seguro do Mercado Pago e nunca trafegam nem são armazenados pela
          C.R Tech.
        </li>

        <li>
          Em caso de falha de pagamento, o acesso pode ser suspenso até a regularização. Os dados
          são preservados durante esse período.
        </li>
      </ul>

      <h2>4. Cancelamento</h2>
      <p>
        O cliente pode cancelar a assinatura a qualquer momento na área de assinatura do sistema ou
        pelo e-mail contato@conferenciarapida.com.br. O acesso permanece disponível até o fim do
        período já pago. Reembolsos seguem a Política de Reembolso.
      </p>

      <h2>5. Disponibilidade e suporte</h2>
      <p>
        Trabalhamos para manter o serviço disponível de forma contínua, podendo haver interrupções
        programadas para manutenção. O suporte é prestado por e-mail em dias úteis.
      </p>

      <h2>6. Propriedade intelectual e dados</h2>
      <p>
        O software, marca e código pertencem à C.R Tech. Os dados operacionais inseridos
        pertencem ao cliente, que pode exportá-los em Excel ou PDF a qualquer momento.
      </p>

      <h2>7. Limitação de responsabilidade</h2>
      <p>
        O serviço é uma ferramenta de apoio à conferência; as decisões operacionais e a conferência
        física são de responsabilidade do cliente. Nossa responsabilidade limita-se ao valor pago nos
        últimos 12 meses de assinatura.
      </p>

      <h2>8. Foro e alterações</h2>
      <p>
        Estes termos são regidos pelas leis brasileiras. Alterações serão publicadas nesta página com
        nova data de atualização e comunicadas com pelo menos 30 dias de antecedência quando
        afetarem preços ou condições essenciais.
      </p>
    </PaginaPublica>
  );
}
