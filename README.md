# Conferência Rápida

Objetivo do Projeto

Desenvolva um aplicativo web moderno, responsivo e escalável para gerenciamento de inventário e conferência de materiais da oficina de caminhões.

O aplicativo será utilizado para realizar inventários físicos dos materiais pertencentes a cada caminhão da frota, permitindo visualizar fotos das peças, registrar quantidades encontradas, controlar divergências, coletar assinatura digital do responsável e manter um histórico completo de todas as conferências realizadas.

O sistema deverá ser intuitivo, rápido e otimizado para uso em smartphones, tablets e computadores.

Tecnologias Obrigatórias

Desenvolver utilizando:

React

TypeScript

Tailwind CSS

shadcn/ui

Supabase Database

Supabase Storage

Supabase Authentication

Utilizar arquitetura limpa, componentes reutilizáveis e código organizado para facilitar futuras expansões.

Estrutura Geral

O aplicativo deverá possuir uma tela inicial contendo todos os caminhões cadastrados.

Os caminhões não devem possuir nomes fixos.

O sistema deverá permitir cadastrar uma quantidade ilimitada de caminhões.

Cada caminhão deverá possuir sua própria lista de materiais, seu próprio histórico de conferências e seus próprios relatórios.

Cadastro de Caminhões

Criar um botão "+ Novo Caminhão".

Ao clicar deverá abrir um formulário contendo:

Nome do caminhão (editável)

Placa

Modelo

Frota

Ano

Setor

Observações

Botões:

Salvar

Cancelar

Também deverá ser possível:

Editar caminhões

Excluir caminhões

Ativar/Inativar caminhões

Cada caminhão cadastrado deverá possuir automaticamente:

Lista própria de materiais

Histórico de conferências

Dashboard individual

Relatórios individuais

Assinaturas digitais

Tela Inicial

Exibir os caminhões em formato de cards contendo:

Nome do caminhão

Placa

Data da última conferência

Percentual concluído

Quantidade total de materiais

Quantidade pendente

Quantidade com divergência

Status da conferência

Ao clicar no card deverá abrir a conferência daquele caminhão.

Dashboard

Cada caminhão deverá possuir indicadores no topo da tela:

Total de materiais

Materiais conferidos

Pendentes

Divergências

Percentual concluído

Data da última conferência

Responsável pela conferência

Cabeçalho da Conferência

No topo deverão existir os seguintes campos:

Caminhão

Data da conferência

Hora de início

Conferente

Responsável pelo caminhão

Status da conferência

A data deverá ser preenchida automaticamente, podendo ser alterada.

Lista de Materiais

Exibir todos os materiais em formato de lista.

Cada linha deverá conter:

Miniatura da foto

Código

Descrição

Quantidade esperada

Status

Status:

Cinza

Não conferido

Verde

Conferido corretamente

Vermelho

Divergência

Ao clicar em um item abrir a tela de conferência.

Tela de Conferência

Ao selecionar um material deverá abrir uma página (ou modal) contendo:

Foto principal grande

Galeria de imagens

Código

Descrição

Quantidade esperada

Campo numérico para quantidade encontrada

Campo de observações

Botão Salvar

Botão Cancelar

Após salvar:

Atualizar automaticamente a lista

Atualizar o Dashboard

Alterar o status do item

Retornar para a lista

Cadastro de Materiais

Criar botão flutuante:

+ Inserir Material

Ao clicar abrir formulário contendo:

Upload de imagens

Código

Descrição

Quantidade esperada

Ao salvar:

Adicionar automaticamente na lista do caminhão.

Importação Automática da Planilha Excel

O aplicativo deverá possuir um botão:

Importar Planilha

Ao importar um arquivo Excel:

Criar automaticamente todos os materiais.

Importar código.

Importar descrição.

Importar quantidade.

Vincular automaticamente cada material ao caminhão correspondente.

Caso algum material não possua imagem:

Exibir um ícone de câmera.

Ao clicar no material deverá ser possível adicionar fotos posteriormente.

Depois de cadastradas, as imagens ficarão vinculadas permanentemente ao código do material.

Nas próximas conferências elas deverão aparecer automaticamente.

Pesquisa

Criar pesquisa instantânea por:

Código

Descrição

Filtros

Criar filtros:

Todos

Pendentes

Conferidos

Divergências

Assinatura Digital

Antes da finalização da conferência o sistema deverá exigir assinatura.

Ao clicar em Finalizar Conferência abrir um modal contendo:

Nome do conferente

Nome do responsável pelo caminhão

Data

Hora

Observações finais

Abaixo deverá existir um campo para assinatura digital.

A assinatura deverá funcionar com:

Mouse

Touchscreen

Caneta digital

Após assinar:

Salvar automaticamente

Registrar data e hora

Bloquear a conferência

Vincular a assinatura ao histórico

A assinatura deverá ser armazenada como imagem.

Histórico

Cada caminhão deverá possuir um histórico completo.

Cada conferência deverá armazenar:

Data

Hora

Caminhão

Conferente

Responsável

Assinatura

Observações

Divergências

Resultado

Ao abrir uma conferência antiga deverá ser possível visualizar todos os materiais conferidos.

Administração

Cada material deverá possuir menu:

Editar

Excluir

Alterar imagens

Banco de Dados

Criar as seguintes tabelas.

Caminhões

id

nome

placa

modelo

frota

ano

setor

observacoes

ativo

Materiais

id

caminhao_id

codigo

descricao

quantidade_esperada

imagem_principal

ImagensMateriais

id

material_id

url_imagem

descricao

Conferencias

id

caminhao_id

data

hora_inicio

hora_fim

conferente

responsavel

assinatura

observacoes

status

ItensConferencia

id

conferencia_id

material_id

quantidade_esperada

quantidade_contada

observacoes

status

Usuarios

id

nome

email

perfil

Exportação

Permitir exportar conferências em:

Excel

PDF

Os relatórios deverão conter:

Caminhão

Data

Conferente

Responsável

Todos os materiais

Quantidade esperada

Quantidade encontrada

Divergências

Assinatura digital

Data da finalização

Funcionalidades Avançadas

Modo Escuro e Claro

Implementar suporte aos temas Light e Dark.

Permitir alternância manual.

Salvar automaticamente a preferência do usuário.

Progressive Web App (PWA)

O aplicativo deverá funcionar como PWA.

Permitir:

Instalação em Android

Instalação em iPhone

Instalação em computadores

Funcionamento em tela cheia

Splash Screen personalizada

Ícone personalizado

O aplicativo deverá se comportar como um aplicativo nativo.

Sincronização Automática

Toda alteração deverá ser sincronizada automaticamente com o Supabase.

Sincronizar em tempo real:

Caminhões

Materiais

Fotos

Conferências

Assinaturas

Relatórios

Salvamento Automático

Durante uma conferência o sistema deverá salvar automaticamente todas as alterações.

Caso o usuário feche o aplicativo, perca conexão ou desligue o dispositivo, ao retornar deverá continuar exatamente do ponto onde parou.

Salvar automaticamente:

Caminhão

Itens conferidos

Quantidades digitadas

Observações

Fotos anexadas

Progresso geral

Upload de Múltiplas Imagens

Cada material poderá possuir diversas imagens.

Exemplos:

Vista frontal

Vista traseira

Vista lateral

Etiqueta

Embalagem

Aplicação

Na tela de conferência deverá existir uma galeria para visualizar todas as imagens.

Registro Fotográfico de Divergências

Quando existir divergência o sistema deverá perguntar automaticamente:

"Deseja anexar fotos desta divergência?"

Permitir:

Tirar foto pela câmera

Escolher imagens da galeria

Anexar múltiplas fotos

Inserir observações

As imagens deverão ficar vinculadas permanentemente à conferência.

Controle de Usuários

Implementar autenticação utilizando Supabase Authentication.

Criar três perfis.

Administrador

Permissões:

Gerenciar caminhões

Gerenciar materiais

Gerenciar usuários

Importar planilhas

Exportar relatórios

Editar conferências assinadas

Desbloquear conferências

Alterar permissões

Conferente

Permissões:

Realizar conferências

Registrar quantidades

Inserir observações

Tirar fotos

Assinar digitalmente

Finalizar conferências

Não poderá editar conferências assinadas.

Visualizador

Permissões:

Somente visualizar:

Caminhões

Materiais

Conferências

Relatórios

Histórico

Segurança

Após a assinatura digital:

Bloquear automaticamente toda a conferência.

Somente Administradores poderão desbloquear.

Registrar todas as alterações realizadas após a assinatura.

Registrar:

Usuário

Data

Hora

Campo alterado

Valor anterior

Novo valor

Motivo

Auditoria

Criar um sistema completo de auditoria.

Registrar automaticamente:

Login

Logout

Cadastro

Alterações

Exclusões

Upload de imagens

Assinaturas

Finalizações

Exportações

Cada registro deverá conter:

Usuário

Data

Hora

Ação

Caminhão

Material

IP (quando disponível)

Dispositivo utilizado (quando disponível)

Performance

O sistema deverá suportar milhares de materiais e centenas de caminhões.

Implementar:

Lazy Loading

Paginação automática

Compressão automática das imagens

Cache inteligente

Pesquisa instantânea

Carregamento rápido

Excelente desempenho em dispositivos móveis

Interface

Criar uma interface moderna, profissional e intuitiva.

Utilizar componentes do shadcn/ui com identidade visual limpa.

Priorizar experiência em dispositivos móveis.

Os botões deverão ser grandes e fáceis de utilizar durante conferências em campo.

Utilizar animações suaves, feedback visual imediato e excelente usabilidade.

O aplicativo deverá transmitir aparência de um sistema corporativo profissional, preparado para crescer com a frota da empresa e suportar futuras funcionalidades sem necessidade de reestruturação.

Preciso que, depois de gerado o histórico, ele seja visível e com opções de exportar o histórico, seja em PDF ou Excel, preciso de um botão funcional em casa histórico gerado, para excluir ele caso necessário, preciso também que, depois que a contagem for iniciada, exista um botão para cancelar/suspender a contagem e uma opção de excluir o material depois de adicionado. O botão da tela inicial está descrito como novo caminhão, altere para apenas novo. Preciso também que no relatório, apareça o horário de início da contagem e do término, e ao fim da página contada, aparece a assinatura do funcionário

Pra finalizar, preciso que altere os nomes: INVENTÁRIO OFICINA se torne CONFERÊNCIA DE MATERIAIS, E NO BALÃO DO NOVO, SEJA RETIRADO O NOME CAMINHÃO das escritas. Preciso também que as cores, sejam a principal laranja, e a secundaria cinza claro,

preciso de um menu com botão interativo depois do login para acessar as frotas dos caminhões, as contagens de estoque e outro botão para selecionar as caixas de ferramentas que serão conferidas, todos com a mesma estrutura de contagem do caminhão oficina, porem ao clicar em novo, na contagem de caixas, tenha as opções nome do funcionário, matricula (código), gestor responsável, a função de adicionar os materiais será a mesma estrutura que o de caminhão, com importação de planilha, edição, exclusão e adição de materiais, o que eu preciso a mais é, ao finalizar, além da assinatura do mecânico, coloque um campo de assinatura do gestor responsável. Seja objetivo, não consuma tanto crédito

Preciso que, tanto na tela inicial da conferencia das caixas quanto das frotas, tenha a opção de deletar as frotas e nomes adicionados,

Na opção de conferefencia das caixas, preciso que ao lado do botao NOVO, tenha um botão de importar planinha, e um botão de filtrar nome de funcionário, nessa planilha vai ter a coluna com o nome do funcionario e código, a coluna de descrição e código do material, e a coluna de quantidade, preciso que ao ser importada, conforme o nome do funcionario for selecionado, apareça os materiais que estaram no seu nome. 

No menu interativo após o login, a opção de contagem de estoque, a estrutura deve ser a seguinte: o botão NOVO, deve ter a opção de importar a lista da prateleira, dando a opção de colocar o título dela antes de importar, após importar, será carregado os dados das colunas, descrição, locação, código, QTD. DO SISTEMA, são números e dados que viram pronto, após a importação, a lista deve ser clicável, permitindo iniciar a conferência, com os mesmos botões das outras conferências existem no menu anterior, com o botão iniciar conferência, cancelar conferência, ao clicar em iniciar conferência, deve aparecer um balão solicitando o número do almoxarife e o código, após isso será iniciado a conferência, preciso que a quantidade de sistema fique oculta, ela deverá aparecer juntamente com as divergências somente após finalizar a contagem, a função de digitar a quantidade contada preciso que seja possível alterar após contar, por exemplo, contém fui pro próximo item, achei mais 2 itens referente ao anterior, eu devo ter acesso ao código anterior pra alterar, após finalizar a contagem, deve aparecer um card de confirmação, após a contagem finalizada, ela deve gerar um histórico também, com as mesmas funções da outra contagem, PDF, Excel, e exclusão.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```

## Aplicativo Android (APK)

O projeto Android fica em [`mobile/`](mobile/README.md) (Capacitor). O APK é gerado
automaticamente pelo workflow **APK Android** do GitHub Actions e publicado em *Releases*.

## Publicação

- **Sistema web:** Cloudflare Workers, publicado pelo workflow *Publicar sistema (Cloudflare Workers)*
  (`.github/workflows/deploy-web.yml`) a cada push na `main` ou manualmente em *Actions*.
  Local: `npm run build` e `npm run deploy` (requer `wrangler login`).
- **Banco e login:** Supabase `phixzybxehifndmukvte` (migrações em `supabase/migrations`).
- **E-mails:** Brevo (`BREVO_API_KEY`), remetente `nao-responda@conferenciarapida.com.br`.
- **Segredos (GitHub → Settings → Secrets → Actions):** `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`,
  `SUPABASE_SERVICE_ROLE_KEY`, `BREVO_API_KEY` e, se usados, `MERCADOPAGO_*`, `WHATSAPP_*`, `MONITOR_HOOK_SECRET`.
