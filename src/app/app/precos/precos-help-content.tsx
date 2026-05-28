import type { ReactNode } from "react";

function HelpFieldBadge({ kind }: { kind: "required" | "optional" }) {
  return (
    <span
      className={
        kind === "required"
          ? "inline-flex shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white bg-rose-600 ring-1 ring-inset ring-rose-700 dark:bg-rose-700 dark:ring-rose-500"
          : "inline-flex shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white bg-emerald-600 ring-1 ring-inset ring-emerald-700 dark:bg-emerald-700 dark:ring-emerald-500"
      }
    >
      {kind === "required" ? "Obrigatório" : "Opcional"}
    </span>
  );
}

function HelpFieldRow({
  name,
  kind,
  children,
}: {
  name: string;
  kind: "required" | "optional";
  children: ReactNode;
}) {
  return (
    <div className="flex gap-3 rounded-lg border border-slate-200/90 bg-white px-3 py-2.5 dark:border-slate-600 dark:bg-slate-800/50">
      <div className="pt-0.5">
        <HelpFieldBadge kind={kind} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-slate-900 dark:text-slate-100">{name}</p>
        <p className="mt-0.5 text-slate-600 dark:text-slate-300">{children}</p>
      </div>
    </div>
  );
}

export function PrecosHelpContent() {
  return (
    <div className="space-y-6 text-sm text-slate-700 dark:text-slate-300">
      <div
        className="flex gap-3 rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sky-950 shadow-sm dark:border-sky-800 dark:bg-sky-950/60 dark:text-sky-100"
        role="note"
      >
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sky-200 text-lg dark:bg-sky-800"
          aria-hidden
        >
          💡
        </span>
        <div>
          <p className="font-semibold text-sky-900 dark:text-sky-50">Leia antes de começar</p>
          <p className="mt-1 text-sky-800/95 dark:text-sky-200/95">
            Leia antes de começar — evita erros comuns e retrabalho. Simular <strong>Promoção</strong> aqui não altera
            o Mercado Livre até você usar <strong>Atualizar preço ML</strong> ou <strong>Criar campanha ML</strong>.
          </p>
        </div>
      </div>

      <section className="space-y-2">
        <div className="flex items-center gap-2">
          <span
            className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#0d6efd]/10 text-lg dark:bg-[#0d6efd]/25"
            aria-hidden
          >
            🧮
          </span>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Para que serve esta tela</h2>
        </div>
        <p>
          A aba <strong>Calculadora</strong> simula preços de venda em massa para anúncios do Mercado Livre: você
          ajusta a coluna <strong>Promoção</strong> ou <strong>Margem</strong> e o sistema calcula taxa ML, frete,
          impostos, lucro e valor líquido.
        </p>
        <p>
          Ao confirmar um preço (Enter ou sair do campo), o valor é gravado como preço planejado (MLB + SKU) e alimenta
          campanhas e exportações. Com <strong>Atualizar preço ML</strong>, o valor da <strong>Promoção</strong> passa
          a ser o preço do anúncio no Mercado Livre.
        </p>
        <p className="text-slate-600 dark:text-slate-400">
          <strong>Pré-requisitos:</strong> conta ML conectada; anúncios sincronizados em{" "}
          <strong>Anúncios</strong>; para custo e margem, produto vinculado em <strong>Produtos</strong>.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Passo a passo</h2>
        <ol className="list-decimal space-y-2.5 pl-5 marker:font-semibold marker:text-[#0d6efd]">
          <li>
            Abra a aba <strong>Calculadora</strong>. Se a lista estiver vazia ou desatualizada, sincronize em{" "}
            <strong>Anúncios</strong> e, nesta tela, use o menu <strong>Ações</strong> →{" "}
            <strong>Atualizar dados</strong>.
          </li>
          <li>
            Contas Mercado Líder (Gold/Platinum) incluem frete nos cálculos automaticamente. Clique no ícone de{" "}
            <strong>funil</strong>, preencha o modal <strong>Filtros</strong> e clique em <strong>Aplicar</strong>.
          </li>
          <li>
            Na tabela, edite <strong>Promoção</strong> (valor em R$) ou <strong>Margem</strong> (%); pressione Enter ou
            clique fora para recalcular e salvar automaticamente.
          </li>
          <li>
            Para várias linhas, marque a coluna de seleção, abra <strong>Ações em massa</strong> (desconto, margem ou
            voltar promoção) ou use o menu <strong>Ações</strong> → <strong>Recalcular taxa e frete</strong>.
          </li>
          <li>
            Com linhas selecionadas, clique em <strong>Criar campanha ML</strong> (promoção no ML via campanha do
            vendedor) ou <strong>Atualizar preço ML</strong> (altera o preço do anúncio) e confirme no modal.
          </li>
          <li>
            No menu <strong>Opções</strong> (⋮), use <strong>Importar CSV</strong> ou <strong>Exportar CSV</strong> para
            planilhas; <strong>Atualizar tabela</strong> recarrega a lista com os filtros atuais.
          </li>
        </ol>
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Campos e o que significam</h2>

        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Barra de ferramentas (aba Calculadora)
          </h3>
          <div className="space-y-2">
            <HelpFieldRow kind="optional" name="Frete nos cálculos">
              Contas Mercado Líder (Gold/Platinum): frete incluído automaticamente. Outras contas: opcional em{" "}
              <strong>Configuração → Frete</strong>.
            </HelpFieldRow>
            <HelpFieldRow kind="optional" name="Ações">
              Menu com <strong>Atualizar dados</strong> (cache de anúncios), <strong>Atualizar competitividade</strong>{" "}
              e <strong>Recalcular taxa e frete</strong> (taxa ML + frete para as linhas visíveis).
            </HelpFieldRow>
            <HelpFieldRow kind="optional" name="Criar campanha ML">
              Cria campanha do vendedor no ML com o preço da <strong>Promoção</strong> salva; exige seleção na tabela e
              desconto ≥ 5% sobre o <strong>Preço</strong>.
            </HelpFieldRow>
            <HelpFieldRow kind="optional" name="Atualizar preço ML">
              Envia o valor da <strong>Promoção</strong> como preço do anúncio no Mercado Livre; exige linhas
              selecionadas e confirmação no modal.
            </HelpFieldRow>
            <HelpFieldRow kind="optional" name="Ações em massa">
              Desconto, restaurar promoção ao preço ML ou margem líquida nos anúncios marcados na coluna de seleção.
            </HelpFieldRow>
          </div>
        </div>

        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Modal Filtros (ícone de funil)
          </h3>
          <div className="space-y-2">
            <HelpFieldRow kind="optional" name="Buscar">
              Texto em título ou MLB; correspondência parcial.
            </HelpFieldRow>
            <HelpFieldRow kind="optional" name="SKU">
              Filtra pelo SKU do produto vinculado.
            </HelpFieldRow>
            <HelpFieldRow kind="optional" name="Status">
              Status do anúncio no ML (Ativo, Pausado, etc.); vazio = todos.
            </HelpFieldRow>
            <HelpFieldRow kind="optional" name="Vínculo MLB → produto">
              Só vinculados, só não vinculados ou todos.
            </HelpFieldRow>
            <HelpFieldRow kind="optional" name="Tags do produto vinculado (qualquer uma)">
              Exibe anúncios cujo produto tenha ao menos uma tag marcada.
            </HelpFieldRow>
            <HelpFieldRow kind="optional" name="Só com vendas (30d)">
              Apenas anúncios com pedido nos últimos 30 dias.
            </HelpFieldRow>
            <HelpFieldRow kind="optional" name="Desconto (%)">
              Compara o desconto entre <strong>Preço</strong> ML e <strong>Promoção</strong> (ex.: igual a 0% = sem
              desconto; menor que 5% = fora do mínimo de campanha ML).
            </HelpFieldRow>
            <HelpFieldRow kind="optional" name="Sem Promo ML ativa">
              Coluna <strong>Promo ML</strong> sem campanhas ativas no cache.
            </HelpFieldRow>
            <HelpFieldRow kind="optional" name="Lucratividade">
              Filtra por faixa de lucro % calculado (até ~2.000 itens carregados com filtros no cliente).
            </HelpFieldRow>
            <HelpFieldRow kind="required" name="Aplicar">
              Confirma filtros do modal e recarrega a tabela; alterações só valem após este clique.
            </HelpFieldRow>
            <HelpFieldRow kind="optional" name="Limpar filtros">
              Remove todos os filtros aplicados e zera o modal.
            </HelpFieldRow>
          </div>
        </div>

        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Colunas editáveis da tabela
          </h3>
          <div className="space-y-2">
            <HelpFieldRow kind="required" name="Promoção">
              Preço bruto simulado (R$, vírgula ou ponto); base para taxas e lucro; gravado ao confirmar o campo.
            </HelpFieldRow>
            <HelpFieldRow kind="optional" name="Margem">
              Margem líquida alvo em %; exige <strong>Custo</strong> e tipo de anúncio; ao confirmar, recalcula a{" "}
              <strong>Promoção</strong>.
            </HelpFieldRow>
          </div>
        </div>

        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Colunas principais (leitura ou calculadas)
          </h3>
          <div className="space-y-2">
            <HelpFieldRow kind="optional" name="MLB">
              Código do anúncio; clique na célula para copiar.
            </HelpFieldRow>
            <HelpFieldRow kind="optional" name="SKU">
              Produto vinculado; cadastro em <strong>Produtos</strong>.
            </HelpFieldRow>
            <HelpFieldRow kind="optional" name="Custo">
              Preço de custo do produto vinculado (somente leitura).
            </HelpFieldRow>
            <HelpFieldRow kind="optional" name="Promo ML">
              Resumo de promoções ativas no Mercado Livre (cache).
            </HelpFieldRow>
            <HelpFieldRow kind="optional" name="Preço">
              Preço atual do anúncio no ML na última sincronização.
            </HelpFieldRow>
            <HelpFieldRow kind="optional" name="Competitividade">
              Indicador de competitividade do ML (sugestão de preço); atualize via <strong>Ações</strong> →{" "}
              <strong>Atualizar competitividade</strong>.
            </HelpFieldRow>
            <HelpFieldRow kind="optional" name="Vai Receber">
              Promoção − taxa ML − frete (calculado).
            </HelpFieldRow>
            <HelpFieldRow kind="optional" name="Lucro">
              Vai receber − custo − imposto − taxa extra − desp. fixas.
            </HelpFieldRow>
            <HelpFieldRow kind="optional" name="Taxa ML / Frete / Imposto / Taxa Extra / Desp. Fixas">
              Derivados da <strong>Promoção</strong> e do cadastro em <strong>Produtos</strong>.
            </HelpFieldRow>
          </div>
        </div>

        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Menu Opções (⋮)
          </h3>
          <div className="space-y-2">
            <HelpFieldRow kind="optional" name="Importar CSV">
              Atualiza <strong>Promoção</strong> ou <strong>Margem</strong> em lote por MLB; confirme em{" "}
              <strong>Confirmar importação</strong> após o preview.
            </HelpFieldRow>
            <HelpFieldRow kind="optional" name="Exportar CSV">
              Baixa linhas visíveis (filtros e página atuais).
            </HelpFieldRow>
            <HelpFieldRow kind="optional" name="Atualizar tabela">
              Recarrega dados sem refazer sync completo no ML.
            </HelpFieldRow>
          </div>
        </div>
      </section>
    </div>
  );
}
