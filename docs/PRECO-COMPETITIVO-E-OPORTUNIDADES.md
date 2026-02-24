# Preço competitivo e oportunidades (referências ML)

## Configuração do endpoint

O endpoint oficial de Referências de preços do Mercado Livre está definido em:

**`src/lib/mercadolivre/priceReferences.ts`**

```ts
export const PRICE_REFERENCE_BASE = "https://api.mercadolibre.com/marketplace/benchmarks";
```

- Lista de itens com referência: `GET {BASE}/user/{USER_ID}/items`
- Detalhes por item: `GET {BASE}/items/{ITEM_ID}/details`

Documentação: https://global-selling.mercadolibre.com/devsite/pricing-reference

## Resumo da implementação

- **Grade atacado:** coluna "Competitividade" com badge (Competitivo / Atenção / Preço alto / Sem referência) e popover com preço atual, referência e botão "Atualizar referência".
- **Filtro:** "Preço alto" na página Atacado e card no Dashboard que leva a `/app/atacado?accountId=...&filter=price_high`.
- **Refresh:** job `refresh_price_references` (todos os itens ou um item) com concorrência 3 e tratamento de 429.

## Exemplo de resposta do status

`GET /api/price-references/status?accountId=...`:

```json
{
  "high": 2,
  "attention": 5,
  "competitive": 10,
  "none": 3,
  "updated_at_last": "2025-02-20T14:30:00.000Z"
}
```

## Exemplo de linha da grade com referência

Cada linha em `GET /api/atacado/rows` passa a incluir:

```json
{
  "item_id": "MLB123",
  "variation_id": null,
  "current_price": 99.9,
  "price_reference_status": "high",
  "reference_summary": {
    "suggested_price": 89.9,
    "min_reference_price": 85,
    "max_reference_price": 95,
    "status": "high",
    "explanation": "Preço atual (R$ 99,90) está 11,1% acima do sugerido (R$ 89,90).",
    "updated_at": "2025-02-20T14:30:00.000Z"
  }
}
```

Sem referência:

```json
{
  "price_reference_status": "none",
  "reference_summary": null
}
```
