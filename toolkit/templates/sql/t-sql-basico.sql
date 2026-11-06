-- 1) Conhecer a tabela
SELECT * FROM treinamento.fato_pedidos LIMIT 20;

-- 2) Filtrar: pedidos entregues do canal app em 2025
SELECT pedido_id, data_pedido, canal, frete
FROM treinamento.fato_pedidos
WHERE status = 'entregue' AND canal = 'app' AND data_pedido >= '2025-01-01'
ORDER BY data_pedido DESC
LIMIT 50;

-- 3) Valores distintos e contagem
SELECT DISTINCT segmento FROM treinamento.dim_clientes;
SELECT COUNT(*) AS total_clientes FROM treinamento.dim_clientes;

-- TODO (exercício): clientes do segmento 'premium' cadastrados após 2024-06-01, ordenados por data.
