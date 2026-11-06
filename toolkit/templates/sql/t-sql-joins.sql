-- Receita e margem por categoria
SELECT pr.categoria,
       SUM(i.quantidade * i.preco_unitario)                      AS receita,
       SUM(i.quantidade * (i.preco_unitario - pr.custo))         AS margem,
       ROUND(100.0 * SUM(i.quantidade * (i.preco_unitario - pr.custo))
             / NULLIF(SUM(i.quantidade * i.preco_unitario),0),1) AS margem_pct
FROM treinamento.fato_itens_pedido i
JOIN treinamento.dim_produtos pr USING (produto_id)
JOIN treinamento.fato_pedidos p  USING (pedido_id)
WHERE p.status <> 'cancelado'
GROUP BY pr.categoria ORDER BY receita DESC;

-- Clientes que NUNCA compraram (LEFT JOIN + IS NULL)
SELECT c.cliente_id, c.nome, c.canal_aquisicao
FROM treinamento.dim_clientes c
LEFT JOIN treinamento.fato_pedidos p USING (cliente_id)
WHERE p.pedido_id IS NULL;

-- Logística: atraso por transportadora
SELECT e.transportadora,
       COUNT(*) AS entregas,
       ROUND(100.0 * AVG((e.data_entrega - e.data_envio > e.prazo_dias)::int),1) AS pct_atraso
FROM treinamento.fato_entregas e
WHERE e.data_entrega IS NOT NULL
GROUP BY 1 ORDER BY pct_atraso DESC;
