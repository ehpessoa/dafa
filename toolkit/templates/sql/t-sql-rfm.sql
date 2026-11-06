-- RFM
WITH base AS (
  SELECT p.cliente_id,
         (DATE '2025-12-31' - MAX(p.data_pedido))              AS recencia_dias,
         COUNT(DISTINCT p.pedido_id)                           AS frequencia,
         SUM(i.quantidade * i.preco_unitario)                  AS valor
  FROM treinamento.fato_pedidos p JOIN treinamento.fato_itens_pedido i USING (pedido_id)
  WHERE p.status <> 'cancelado' GROUP BY 1
), score AS (
  SELECT *, NTILE(5) OVER (ORDER BY recencia_dias DESC) AS r,
            NTILE(5) OVER (ORDER BY frequencia)         AS f,
            NTILE(5) OVER (ORDER BY valor)              AS m
  FROM base
)
SELECT *, CASE WHEN r>=4 AND f>=4 THEN 'Campeões'
               WHEN r>=3 AND f>=3 THEN 'Leais'
               WHEN r<=2 AND f>=3 THEN 'Em risco'
               WHEN r<=2 THEN 'Hibernando' ELSE 'Potencial' END AS segmento_rfm
FROM score;

-- Coorte: clientes ativos por mês desde a 1ª compra
WITH primeira AS (
  SELECT cliente_id, date_trunc('month', MIN(data_pedido))::date AS coorte
  FROM treinamento.fato_pedidos GROUP BY 1)
SELECT pr.coorte,
       (EXTRACT(year FROM age(date_trunc('month',p.data_pedido), pr.coorte))*12
        + EXTRACT(month FROM age(date_trunc('month',p.data_pedido), pr.coorte)))::int AS mes_n,
       COUNT(DISTINCT p.cliente_id) AS clientes
FROM treinamento.fato_pedidos p JOIN primeira pr USING (cliente_id)
GROUP BY 1,2 ORDER BY 1,2;
