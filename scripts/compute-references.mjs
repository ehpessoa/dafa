// Calcula os números de referência (gabarito) a partir do banco de treinamento, que é determinístico (setseed).
// Saída: content/references.mjs — usado por content/rubrics.mjs e pelo corretor de IA.
// Uso: node scripts/compute-references.mjs
import { writeFileSync } from 'node:fs';
import { bootDb } from './validate-sql.mjs';

const db = await bootDb();
const REC = `SUM(i.quantidade * i.preco_unitario)`;
const FROM = `treinamento.fato_itens_pedido i JOIN treinamento.fato_pedidos p USING (pedido_id)`;
const Q = {
  'd02-e1': { desc: 'Tamanho e qualidade de fato_pedidos', sql: `
    SELECT count(*) AS linhas, count(*) - count(DISTINCT pedido_id) AS ids_duplicados,
           count(*) FILTER (WHERE status IS NULL) AS status_nulos, count(*) FILTER (WHERE canal IS NULL) AS canal_nulos,
           count(*) FILTER (WHERE data_pedido IS NULL) AS data_nulos FROM treinamento.fato_pedidos` },
  'd03-e1': { desc: 'Receita por canal (itens, exclui cancelados)', sql: `
    SELECT p.canal, ROUND(${REC},2) AS receita FROM ${FROM} WHERE p.status <> 'cancelado' GROUP BY 1 ORDER BY 2 DESC` },
  'd03-e2': { desc: 'Receita, custo e margem totais (exclui cancelados)', sql: `
    SELECT ROUND(${REC},2) AS receita, ROUND(SUM(i.quantidade*pr.custo),2) AS custo,
           ROUND(${REC} - SUM(i.quantidade*pr.custo),2) AS margem,
           ROUND(100*(${REC} - SUM(i.quantidade*pr.custo))/${REC},1) AS margem_pct
    FROM ${FROM} JOIN treinamento.dim_produtos pr USING (produto_id) WHERE p.status <> 'cancelado'` },
  'd03-e3': { desc: '% de entregas com atraso por transportadora (data_entrega - data_envio > prazo_dias)', sql: `
    SELECT transportadora, count(*) AS entregas, ROUND(100.0*avg((data_entrega-data_envio>prazo_dias)::int),1) AS pct_atraso
    FROM treinamento.fato_entregas WHERE data_entrega IS NOT NULL GROUP BY 1 ORDER BY 1` },
  'd04-e2': { desc: 'Top 5 UF por receita; mês de pico; ticket médio por canal', sql: `
    SELECT 'uf' AS tipo, p.uf_entrega AS chave, ROUND(${REC},2) AS valor FROM ${FROM} WHERE p.status<>'cancelado' GROUP BY 2 ORDER BY 3 DESC LIMIT 5` },
  'd04-e2b': { desc: 'Mês de pico de receita', sql: `
    SELECT date_trunc('month',p.data_pedido)::date AS mes, ROUND(${REC},2) AS receita FROM ${FROM} WHERE p.status<>'cancelado' GROUP BY 1 ORDER BY 2 DESC LIMIT 1` },
  'd04-e2c': { desc: 'Ticket médio por canal (receita ÷ pedidos)', sql: `
    SELECT p.canal, ROUND(${REC}/count(DISTINCT p.pedido_id),2) AS ticket_medio FROM ${FROM} WHERE p.status<>'cancelado' GROUP BY 1 ORDER BY 2 DESC` },
  'd06-e2': { desc: 'Contagem de linhas por tabela', sql: `
    SELECT 'dim_clientes' t, count(*) FROM treinamento.dim_clientes UNION ALL SELECT 'dim_produtos', count(*) FROM treinamento.dim_produtos
    UNION ALL SELECT 'fato_pedidos', count(*) FROM treinamento.fato_pedidos UNION ALL SELECT 'fato_itens_pedido', count(*) FROM treinamento.fato_itens_pedido
    UNION ALL SELECT 'fato_entregas', count(*) FROM treinamento.fato_entregas UNION ALL SELECT 'fato_campanhas', count(*) FROM treinamento.fato_campanhas
    UNION ALL SELECT 'fato_financeiro', count(*) FROM treinamento.fato_financeiro UNION ALL SELECT 'esporte_partidas', count(*) FROM treinamento.esporte_partidas` },
  'd08-e1': { desc: 'Receita por ano (total por mês: 24+ linhas; aqui os totais anuais para conferência)', sql: `
    SELECT extract(year FROM p.data_pedido)::int AS ano, ROUND(${REC},2) AS receita, count(DISTINCT date_trunc('month',p.data_pedido)) AS meses
    FROM ${FROM} WHERE p.status<>'cancelado' GROUP BY 1 ORDER BY 1` },
  'd08-e2': { desc: 'CTR, CPC e CPA por canal de campanha (ROAS exige premissa de receita)', sql: `
    SELECT canal, SUM(investimento) AS investimento, SUM(impressoes) AS impressoes, SUM(cliques) AS cliques, SUM(conversoes) AS conversoes,
           ROUND(100.0*SUM(cliques)/SUM(impressoes),2) AS ctr_pct, ROUND(SUM(investimento)/SUM(cliques),2) AS cpc,
           ROUND(SUM(investimento)/SUM(conversoes),2) AS cpa FROM treinamento.fato_campanhas GROUP BY 1 ORDER BY 1` },
  'd08-e3': { desc: 'Pedidos não cancelados e valor médio (para validar faixas: a soma das faixas deve fechar o total)', sql: `
    SELECT count(*) AS pedidos, ROUND(avg(v),2) AS valor_medio, ROUND(min(v),2) AS minimo, ROUND(max(v),2) AS maximo FROM (
      SELECT p.pedido_id, ${REC} AS v FROM ${FROM} WHERE p.status<>'cancelado' GROUP BY 1) t` },
  'd11-e1': { desc: 'Receita, custo e margem % por categoria (exclui cancelados)', sql: `
    SELECT pr.categoria, ROUND(${REC},2) AS receita, ROUND(SUM(i.quantidade*pr.custo),2) AS custo,
           ROUND(100*(${REC}-SUM(i.quantidade*pr.custo))/${REC},1) AS margem_pct
    FROM ${FROM} JOIN treinamento.dim_produtos pr USING (produto_id) WHERE p.status<>'cancelado' GROUP BY 1 ORDER BY 2 DESC` },
  'd11-e2': { desc: 'Clientes sem nenhum pedido, por canal de aquisição', sql: `
    SELECT c.canal_aquisicao, count(*) AS clientes_sem_compra FROM treinamento.dim_clientes c
    WHERE NOT EXISTS (SELECT 1 FROM treinamento.fato_pedidos p WHERE p.cliente_id = c.cliente_id) GROUP BY 1 ORDER BY 1` },
  'd12-e1': { desc: 'Receita mensal: primeiros 3 meses, para conferir mês anterior / var % / acumulado', sql: `
    SELECT date_trunc('month',p.data_pedido)::date AS mes, ROUND(${REC},2) AS receita FROM ${FROM} WHERE p.status<>'cancelado' GROUP BY 1 ORDER BY 1 LIMIT 3` },
  'd12-e2': { desc: 'Produto nº 1 de cada categoria por receita', sql: `
    SELECT categoria, nome, receita FROM (
      SELECT pr.categoria, pr.nome, ROUND(${REC},2) AS receita, RANK() OVER (PARTITION BY pr.categoria ORDER BY ${REC} DESC) AS rk
      FROM ${FROM} JOIN treinamento.dim_produtos pr USING (produto_id) WHERE p.status<>'cancelado' GROUP BY 1,2) t WHERE rk = 1 ORDER BY 1` },
  'd12-e3': { desc: 'Líder e último da classificação da temporada 2024 (3 pts vitória, 1 empate)', sql: `
    WITH j AS (SELECT mandante AS time, gols_mandante gp, gols_visitante gc FROM treinamento.esporte_partidas WHERE temporada=2024
               UNION ALL SELECT visitante, gols_visitante, gols_mandante FROM treinamento.esporte_partidas WHERE temporada=2024),
    t AS (SELECT time, count(*) AS j, SUM(CASE WHEN gp>gc THEN 3 WHEN gp=gc THEN 1 ELSE 0 END) AS pts, SUM(gp-gc) AS saldo, SUM(gp) AS gp FROM j GROUP BY 1)
    SELECT time, j, pts, saldo, gp FROM t ORDER BY pts DESC, saldo DESC, gp DESC LIMIT 3` },
  'd22-e1': { desc: 'Distribuição dos segmentos RFM do template t-sql-rfm (ref. 2025-12-31)', sql: `
    WITH base AS (SELECT p.cliente_id, (DATE '2025-12-31' - MAX(p.data_pedido)) AS recencia_dias, COUNT(DISTINCT p.pedido_id) AS frequencia, SUM(i.quantidade*i.preco_unitario) AS valor
      FROM treinamento.fato_pedidos p JOIN treinamento.fato_itens_pedido i USING (pedido_id) WHERE p.status <> 'cancelado' GROUP BY 1),
    score AS (SELECT *, NTILE(5) OVER (ORDER BY recencia_dias DESC) r, NTILE(5) OVER (ORDER BY frequencia) f, NTILE(5) OVER (ORDER BY valor) m FROM base)
    SELECT CASE WHEN r>=4 AND f>=4 THEN 'Campeões' WHEN r>=3 AND f>=3 THEN 'Leais' WHEN r<=2 AND f>=3 THEN 'Em risco' WHEN r<=2 THEN 'Hibernando' ELSE 'Potencial' END AS segmento, count(*) AS clientes
    FROM score GROUP BY 1 ORDER BY 2 DESC` },
  'd25-e1': { desc: 'DRE: totais do período (receitas, despesas, resultado)', sql: `
    SELECT ROUND(SUM(valor) FILTER (WHERE tipo='receita'),2) AS receitas, ROUND(SUM(valor) FILTER (WHERE tipo='despesa'),2) AS despesas,
           ROUND(SUM(CASE WHEN tipo='receita' THEN valor ELSE -valor END),2) AS resultado, count(DISTINCT date_trunc('month',data)) AS meses FROM treinamento.fato_financeiro` },
};

const out = {};
for (const [k, q] of Object.entries(Q)) {
  const { rows } = await db.query(q.sql);
  out[k] = { desc: q.desc, sql: q.sql.replace(/\s+/g, ' ').trim(), rows: JSON.parse(JSON.stringify(rows, (_, v) => (typeof v === 'bigint' ? Number(v) : v))) };
  console.log(`\n${k} — ${q.desc}`); console.table(rows.slice(0, 8));
}
writeFileSync(new URL('../content/references.mjs', import.meta.url),
  `// GERADO por scripts/compute-references.mjs a partir do banco de treinamento (setseed 0.42). Não edite à mão.\nexport const references = ${JSON.stringify(out, null, 2)};\n`);
