# Posição atual no monitoramento

## Objetivo
Mostrar em cada conferência do card “Monitoramento em tempo real” a localização em que a contagem está, preservando todas as informações atuais.

## Implementação
- Ampliar os dados dos itens acompanhados em tempo real para incluir localização, quantidade contada e última atualização.
- Definir como posição atual o local do item contado mais recentemente; antes da primeira contagem, mostrar a primeira localização pendente.
- Exibir “Posição atual: P01 - A01” em destaque dentro de cada conferência.
- Manter a atualização automática quando um item for contado, pausado ou retomado.

## Validação
- Conferir tipagem do projeto.
- Verificar visualmente o card em tela pequena e desktop, sem remover métricas existentes.
