/**
 * Categorias fixas para telas de Custos Operacionais e Impostos (Produtos).
 * Valores são persistidos por user_id + category_key.
 */

export const OPERATIONAL_COST_CATEGORIES = [
  {
    key: "payroll",
    label: "Folha de pagamento",
    examples: "salários, pró-labore, encargos",
  },
  {
    key: "rent",
    label: "Aluguel",
    examples: "aluguel do espaço físico",
  },
  {
    key: "electricity",
    label: "Energia elétrica",
    examples: "luz e consumo operacional",
  },
  {
    key: "internet_phone",
    label: "Internet e telefone",
    examples: "comunicação da empresa",
  },
  {
    key: "software",
    label: "Softwares",
    examples: "ERP, CRM, sistemas, licenças",
  },
  {
    key: "accounting",
    label: "Contabilidade",
    examples: "serviços contábeis",
  },
  {
    key: "marketing",
    label: "Marketing",
    examples: "anúncios e divulgação",
  },
  {
    key: "banking_fees",
    label: "Taxas bancárias",
    examples: "banco, maquininhas, PIX",
  },
  {
    key: "logistics",
    label: "Logística e transporte",
    examples: "fretes, combustível, entregas",
  },
  {
    key: "maintenance_office",
    label: "Manutenção e escritório",
    examples: "limpeza, manutenção, materiais",
  },
  {
    key: "other_operational",
    label: "Outros",
    examples: "demais custos operacionais não listados acima",
  },
] as const;

export type OperationalCostCategoryKey = (typeof OPERATIONAL_COST_CATEGORIES)[number]["key"];

const OPERATIONAL_KEYS = new Set<string>(OPERATIONAL_COST_CATEGORIES.map((c) => c.key));

export function isOperationalCategoryKey(k: string): k is OperationalCostCategoryKey {
  return OPERATIONAL_KEYS.has(k);
}

/** Impostos e contribuições típicas (percentuais); complementam o imposto por produto. */
export const TAX_PARAMETER_CATEGORIES = [
  {
    key: "simples_nacional",
    label: "Simples Nacional",
    examples: "alíquota efetiva (DAS), anexo do Simples",
  },
  {
    key: "icms",
    label: "ICMS",
    examples: "operações com mercadorias, substituição tributária",
  },
  {
    key: "iss",
    label: "ISS",
    examples: "serviços municipais",
  },
  {
    key: "pis_cofins",
    label: "PIS / COFINS",
    examples: "contribuições federais (conforme regime)",
  },
  {
    key: "ir_csll",
    label: "IR / CSLL",
    examples: "lucro presumido, real ou outras apurações",
  },
  {
    key: "ipi",
    label: "IPI",
    examples: "industrialização, quando aplicável",
  },
  {
    key: "other_taxes",
    label: "Outros impostos e taxas",
    examples: "contribuições diversas, taxas estaduais/municipais",
  },
] as const;

export type TaxParameterCategoryKey = (typeof TAX_PARAMETER_CATEGORIES)[number]["key"];

const TAX_KEYS = new Set<string>(TAX_PARAMETER_CATEGORIES.map((c) => c.key));

export function isTaxParameterCategoryKey(k: string): k is TaxParameterCategoryKey {
  return TAX_KEYS.has(k);
}
