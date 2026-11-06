// Exporta o schema treinamento para CSVs em .tmp/csv (usado para gerar o Excel do treinamento).
import { mkdirSync, writeFileSync } from 'node:fs';
import { bootDb } from './validate-sql.mjs';
const db = await bootDb();
mkdirSync('.tmp/csv', { recursive: true });
const tables = ['dim_clientes','dim_produtos','fato_pedidos','fato_itens_pedido','fato_entregas','fato_campanhas','fato_financeiro','esporte_partidas'];
for (const t of tables) {
  const { rows, fields } = await db.query(`select * from treinamento.${t} order by 1`);
  const esc = (v) => v == null ? '' : v instanceof Date ? v.toISOString().slice(0, 10) : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v);
  writeFileSync(`.tmp/csv/${t}.csv`, [fields.map((f) => f.name).join(','), ...rows.map((r) => fields.map((f) => esc(r[f.name])).join(','))].join('\n'));
  console.log(t, rows.length);
}
