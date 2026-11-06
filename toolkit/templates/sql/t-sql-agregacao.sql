-- Pedidos e frete médio por canal
SELECT canal, COUNT(*) AS pedidos, ROUND(AVG(frete),2) AS frete_medio
FROM treinamento.fato_pedidos
WHERE status <> 'cancelado'
GROUP BY canal
ORDER BY pedidos DESC;

-- Receita por mês (itens)
SELECT date_trunc('month', p.data_pedido)::date AS mes,
       SUM(i.quantidade * i.preco_unitario) AS receita
FROM treinamento.fato_itens_pedido i
JOIN treinamento.fato_pedidos p USING (pedido_id)
WHERE p.status <> 'cancelado'
GROUP BY 1 ORDER BY 1;

-- Estados com mais de 200 pedidos
SELECT uf_entrega, COUNT(*) AS pedidos
FROM treinamento.fato_pedidos
GROUP BY uf_entrega HAVING COUNT(*) > 200
ORDER BY pedidos DESC;
