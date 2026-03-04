# Sistema de design — EscalaPreço

Padrões visuais inspirados no [TailAdmin](https://tailadmin.com/) (Tailwind CSS Admin Dashboard), aplicados de forma consistente em todo o app.

---

## Cores (Tailwind)

| Uso | Classe | Light | Dark |
|-----|--------|--------|------|
| **Primary** | `primary`, `primary-light`, `primary-dark`, `primary-darker` | #3C50E0 e variações | mesmo |
| **Secondary** | `secondary`, `secondary-light`, `secondary-dark` | #64748B | mesmo |
| **Background corpo** | `body` | #F1F5F9 | #0F172A |
| **Bordas** | `stroke` | #E2E8F0 | #334155 |
| **Sucesso** | `success`, `success-light`, `success-dark` | #12B76A | mesmo |
| **Erro** | `error`, `error-light`, `error-dark` | #F04438 | mesmo |
| **Aviso** | `warning`, `warning-light`, `warning-dark` | #F79009 | mesmo |

Variáveis CSS em `globals.css`: `--body-bg`, `--body-text`, `--card-bg`, `--card-border`, `--primary`, etc. O modo escuro é controlado pela classe `.dark` no `<html>`.

---

## Componentes

### Cards

- **Container**: `card` — borda, fundo, sombra e `rounded-app`.
- **Cabeçalho**: `card-header` — borda inferior, padding.
- **Corpo**: `card-body` — padding.
- **Título**: `card-title`.

```html
<div class="card">
  <div class="card-header">
    <h2 class="card-title">Título do card</h2>
  </div>
  <div class="card-body">Conteúdo</div>
</div>
```

### Botões

| Classe | Uso |
|--------|-----|
| `btn btn-primary` | Ação principal (salvar, enviar) |
| `btn btn-secondary` | Ação secundária (cancelar, voltar) |
| `btn btn-danger` | Ação destrutiva (excluir) |
| `btn btn-ghost` | Ação discreta (link visual) |
| `btn btn-soft-success` | Sucesso suave (ex.: vincular) |
| `btn btn-soft-warning` | Aviso suave (ex.: SKUs não cadastrados) |
| `btn btn-soft-danger` | Perigo suave (ex.: excluir todos) |

Sempre use a base `btn` junto com a variante (ex.: `btn btn-primary`).

### Inputs

- **Campo**: `input` — borda, foco com cor primary, placeholder e estados dark.
- **Erro**: adicione `input-error` ao lado de `input`.
- **Label**: `label`.

```html
<label class="label">Nome</label>
<input type="text" class="input" placeholder="Digite..." />
```

### Badges

| Classe | Uso |
|--------|-----|
| `badge badge-primary` | Destaque neutro |
| `badge badge-success` | Status positivo (ativo, concluído) |
| `badge badge-error` | Status negativo (erro, inativo) |
| `badge badge-warning` | Atenção (pendente, aviso) |
| `badge badge-neutral` | Informação neutra |

### Tabs

- **Lista**: `tabs-list`.
- **Item**: `tab-item`; item ativo: `tab-item active`.

```html
<div class="tabs-list">
  <button type="button" class="tab-item active">Aba 1</button>
  <button type="button" class="tab-item">Aba 2</button>
</div>
```

### Alertas

| Classe | Uso |
|--------|-----|
| `alert alert-info` | Informação (dicas, links) |
| `alert alert-success` | Sucesso (confirmação, conectado) |
| `alert alert-warning` | Aviso (não conectado, atenção) |
| `alert alert-error` | Erro (falha, validação) |

### Modais

- **Overlay**: `modal-overlay`.
- **Container**: `modal-content`.
- **Cabeçalho**: `modal-header` + `modal-title`.
- **Corpo**: `modal-body`.
- **Rodapé**: `modal-footer` (botões alinhados à direita).

### Tabelas

Use o componente `<AppTable>` com a classe `app-table` na `<table>`. O estilo do cabeçalho (sticky, gradiente primary) e das linhas (zebrado, hover) está em `globals.css` (`.app-table`).

### Títulos de página

- **Página**: `page-title`.
- **Seção**: `section-title`.
- **Descrição**: `section-desc`.

---

## Tokens de layout

- **Raio padrão**: `rounded-app` (0.5rem).
- **Raio grande**: `rounded-app-lg` (0.75rem).
- **Sombra de card**: `shadow-card`.
- **Sombra de dropdown/modal**: `shadow-dropdown`.

---

## Sidebar (uso futuro)

Para uma navegação lateral estilo TailAdmin:

- **Container**: `sidebar`.
- **Link**: `sidebar-link`.
- **Link ativo**: `sidebar-link active`.

---

## Migração

Nas páginas existentes, você pode substituir gradualmente:

- Containers de conteúdo: `rounded-lg border border-gray-200 bg-white ...` → `card` (+ `card-body` se quiser).
- Botão principal: `rounded bg-brand-blue ...` → `btn btn-primary`.
- Botão secundário: `rounded border border-gray-300 bg-white ...` → `btn btn-secondary`.
- Inputs: `rounded border border-gray-300 ...` → `input` e `label`.
- Abas: usar `tabs-list` e `tab-item` / `tab-item active`.
- Alertas: usar `alert alert-info` / `alert-success` / etc.
- Badges de status: usar `badge badge-success` / `badge-warning` / etc.

Mantemos as cores `brand-blue`, `brand-orange` no Tailwind para compatibilidade; o novo padrão é `primary` e variantes.
