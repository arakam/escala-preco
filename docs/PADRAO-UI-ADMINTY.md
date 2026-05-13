# Padrão UI Adminty

Este documento registra o padrão visual adotado para as áreas autenticadas do app (`/app/*`). O layout antigo com topo em gradiente deve ser considerado em desuso.

## Shell da aplicação

- Usar o shell lateral inspirado no Adminty como padrão para todas as páginas de `/app`.
- A sidebar deve conter logo, botão de recolher/expandir no topo, navegação principal e ação de sair no rodapé.
- A conta conectada deve aparecer no topo da página, não na sidebar.
- O topo da página deve exibir breadcrumb curto no formato `Painel / <Página>`.
- A fonte padrão do shell é Open Sans via `next/font/google`.

## Estrutura de tela

Páginas com listagens devem seguir esta ordem:

1. Aba ou título de contexto no topo do card.
2. Linha de ações primárias à esquerda.
3. Linha de filtros aplicados, com chips resumindo os filtros ativos.
4. Ícone de filtros no canto direito, abrindo modal.
5. Ícone de opções no canto direito para ações como exportar e atualizar.
6. Linha compacta de resumo/paginação.
7. Tabela.

## DataTable

O componente base continua sendo `AppTable`, com a classe `app-table`.

Regras do padrão:

- Cabeçalho fixo no scroll vertical.
- Scroll horizontal para tabelas largas.
- Cabeçalho em tons de azul.
- Menu no título da coluna para ordenar e congelar.
- Ordenação não deve aparecer como ícones antigos fixos no título.
- Congelamento de colunas deve permitir múltiplas colunas e persistir no `localStorage` quando fizer sentido para a tela.
- Paginação deve ser compacta e incluir seleção de linhas por página.

## Cores principais

- Sidebar: `#404e67`.
- Acento do shell: `#01a9ac`.
- Cabeçalho de tabela: gradiente azul `#2f80ed -> #0d6efd -> #0b5ed7`.
- Fundo de página: `#ecf0f5`.

## Botões (referência [Adminty — Button](https://colorlib.com/polygon/adminty/default/pages/button.html))

- **Ações sólidas (Basic):** combinar `btn` com variante — `btn-primary` (azul padrão ML/tabela), `btn-secondary` (branco com borda), `btn-success`, `btn-info`, `btn-warning`, `btn-danger`, `btn-inverse`. Tamanhos: `btn-sm`, `btn-mini`, `btn-lg`.
- **Dropdown:** wrapper `btn-dropdown`; lista `btn-dropdown-menu`; cada linha `btn-dropdown-item` (texto; sem ícone obrigatório). O gatilho combina `btn` + variante + `btn-sm` e seta em SVG quando necessário.
- **Só ícone (Icon Border):** `btn btn-icon btn-sm btn-outline-secondary` (filtros, menu ⋮, relógio, fechar modal com ✕). Primário em destaque: `btn-outline-primary`.

Evitar ícones decorativos dentro de botões com texto; manter texto claro no rótulo.

## Preferências de implementação

- Criar variações reaproveitáveis antes de duplicar controles de tabela em várias páginas.
- Evitar novos layouts locais com header próprio dentro de `/app/*`.
- Se uma tela precisar fugir do padrão, documentar o motivo no próprio PR ou comentário próximo ao componente.
