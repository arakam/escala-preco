import type { RecebimentoDaySummary, RecebimentoRow } from "./types";

export function summarizeRecebimentoRows(
  rows: RecebimentoRow[],
  referenceDate: string
): RecebimentoDaySummary {
  const dayStart = new Date(`${referenceDate}T00:00:00`).getTime();
  const dayEnd = new Date(`${referenceDate}T23:59:59.999`).getTime();

  let released_total = 0;
  let scheduled_total = 0;
  let pending_total = 0;
  let row_count = 0;

  for (const row of rows) {
    if (!row.money_release_date) continue;
    const releaseTs = new Date(row.money_release_date).getTime();
    if (!Number.isFinite(releaseTs) || releaseTs < dayStart || releaseTs > dayEnd) continue;

    row_count += 1;
    if (row.money_release_status === "released") {
      released_total += row.net_to_receive;
    } else if (row.money_release_status === "scheduled") {
      scheduled_total += row.net_to_receive;
    } else {
      pending_total += row.net_to_receive;
    }
  }

  const released = Math.round(released_total * 100) / 100;
  const scheduled = Math.round(scheduled_total * 100) / 100;
  const pending = Math.round(pending_total * 100) / 100;

  return {
    date: referenceDate,
    released_total: released,
    scheduled_total: scheduled,
    pending_total: pending,
    total_net: Math.round((released + scheduled + pending) * 100) / 100,
    row_count,
  };
}
