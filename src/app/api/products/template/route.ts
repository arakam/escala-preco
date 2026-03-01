import { NextResponse } from "next/server";

export async function GET() {
  const headers = ["SKU", "Titulo", "Descricao", "EAN", "Altura", "Largura", "Comprimento", "Peso", "PrecoCusto", "PrecoVenda"];
  
  const exampleRow = [
    "SKU-001",
    "Produto Exemplo",
    "Descrição do produto exemplo",
    "7891234567890",
    "10",
    "20",
    "30",
    "0.5",
    "50.00",
    "99.90",
  ];

  const csv = [headers.join(";"), exampleRow.join(";")].join("\n");

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="modelo_produtos.csv"',
    },
  });
}
