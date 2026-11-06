WITH receita_mensal AS (
  SELECT date_trunc('month', p.data_pedido)::date AS mes,
         SUM(i.quantidade * i.preco_unitario) AS receita
  FROM treinamento.fato_itens_pedido i
  JOIN treinamento.fato_pedidos p USING (pedido_id)
  WHERE p.status <> 'cancelado'
  GROUP BY 1
)
SELECT mes, receita,
       LAG(receita) OVER (ORDER BY mes)                                  AS receita_mes_ant,
       ROUND(100.0*(receita/NULLIF(LAG(receita) OVER (ORDER BY mes),0)-1),1) AS var_pct,
       SUM(receita) OVER (ORDER BY mes)                                  AS acumulado
FROM receita_mensal ORDER BY mes;

-- Top 3 produtos por categoria
SELECT * FROM (
  SELECT pr.categoria, pr.nome,
         SUM(i.quantidade) AS unidades,
         RANK() OVER (PARTITION BY pr.categoria ORDER BY SUM(i.quantidade) DESC) AS rk
  FROM treinamento.fato_itens_pedido i JOIN treinamento.dim_produtos pr USING (produto_id)
  GROUP BY pr.categoria, pr.nome
) t WHERE rk <= 3;
