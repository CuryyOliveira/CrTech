import { createFileRoute } from "@tanstack/react-router";
import { PaginaPublica } from "@/components/publico/RodapeLegal";

const TITULO = "Política de Privacidade — C.R Tech";
const DESCRICAO =
  "Como a C.R Tech coleta, usa, armazena e protege os dados pessoais dos usuários do sistema Conferência Rápida.";

export const Route = createFileRoute("/privacidade")({
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
  component: Privacidade,
});

function Privacidade() {
  return (
    <PaginaPublica titulo="Política de Privacidade" atualizado="11 de agosto de 2026">
      <p>
        Esta política descreve como a <strong>C.R Tech</strong> trata os dados pessoais dos
        usuários do sistema Conferência Rápida, em conformidade com a Lei Geral de Proteção de
        Dados (Lei nº 13.709/2018).
      </p>

      <h2>1. Dados que coletamos</h2>
      <ul>
        <li>Dados de cadastro: nome, e-mail, setor, perfil de acesso e foto opcional.</li>
        <li>Dados da empresa: razão social ou nome, CNPJ, telefone e e-mail de contato.</li>
        <li>
          Dados de uso: conferências realizadas, materiais contados, unidades, horários, assinatura
          digital, registros de auditoria, endereço IP e dispositivo utilizado.
        </li>
        <li>
          Dados de cobrança: plano contratado, status e histórico da assinatura. Os pagamentos são
          processados pelo Mercado Pago, nosso provedor de pagamentos. Os dados de pagamento,
          incluindo dados de cartão, são informados diretamente no ambiente do Mercado Pago e nunca
          trafegam nem são armazenados por nós.
        </li>

      </ul>

      <h2>2. Para que usamos os dados</h2>
      <ul>
        <li>Permitir o acesso à conta e a operação das conferências.</li>
        <li>Gerar relatórios, históricos e indicadores para a empresa contratante.</li>
        <li>Enviar notificações operacionais e comunicados sobre o serviço.</li>
        <li>Processar a assinatura, faturamento e prevenção a fraudes.</li>
        <li>Cumprir obrigações legais e atender requisições de autoridades.</li>
      </ul>

      <h2>3. Compartilhamento</h2>
      <p>
        A C.R Tech atua como controladora dos dados e é a vendedora do serviço. Não vendemos dados
        pessoais. Compartilhamos apenas com fornecedores necessários à operação: provedor de
        infraestrutura e banco de dados, provedor de envio de e-mails, consultores profissionais
        (jurídico e contábil), autoridades quando exigido por lei e o Mercado Pago, nosso provedor de
        pagamentos, responsável pelo processamento das cobranças, gestão da recorrência e emissão dos
        comprovantes. Cada empresa
        contratante acessa somente os dados da sua própria operação. Alguns desses fornecedores podem
        estar fora do Brasil; nesses casos utilizamos cláusulas contratuais e salvaguardas adequadas.
      </p>

      <h2>4. Armazenamento e segurança</h2>
      <p>
        Os dados são armazenados em servidores com acesso restrito e criptografia em trânsito.
        Aplicamos controle de acesso por perfil, isolamento por empresa, registro de auditoria e
        criptografia local do acesso offline. Mantemos os dados enquanto a conta estiver ativa e
        pelos prazos legais aplicáveis após o encerramento.
      </p>

      <h2>5. Seus direitos</h2>
      <p>
        Você pode solicitar confirmação de tratamento, acesso, correção, portabilidade, anonimização
        ou exclusão dos seus dados, além de revogar consentimentos. Basta escrever para
        contato@conferenciarapida.com.br; responderemos em até 15 dias.
      </p>

      <h2>6. Cookies</h2>
      <p>
        Utilizamos apenas armazenamento local e cookies essenciais para manter a sessão do usuário e
        o funcionamento offline. Não utilizamos cookies de publicidade.
      </p>

      <h2>7. Contato</h2>
      <p>
        C.R Tech — contato@conferenciarapida.com.br. Alterações nesta política serão
        publicadas nesta página com nova data de atualização.
      </p>
    </PaginaPublica>
  );
}
