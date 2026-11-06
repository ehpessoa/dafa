-- DRE mensal
SELECT date_trunc('month', data)::date AS mes,
       SUM(valor) FILTER (WHERE tipo = 'receita') AS receitas,
       SUM(valor) FILTER (WHERE tipo = 'despesa') AS despesas,
       SUM(CASE WHEN tipo='receita' THEN valor ELSE -valor END) AS resultado
FROM treinamento.fato_financeiro GROUP BY 1 ORDER BY 1;

-- Caixa acumulado
SELECT mes, resultado, SUM(resultado) OVER (ORDER BY mes) AS caixa_acumulado
FROM (SELECT date_trunc('month', data)::date AS mes,
             SUM(CASE WHEN tipo='receita' THEN valor ELSE -valor END) AS resultado
      FROM treinamento.fato_financeiro GROUP BY 1) m;

-- Despesas por centro de custo (participação %)
SELECT centro_custo, SUM(valor) AS total,
       ROUND(100.0*SUM(valor)/SUM(SUM(valor)) OVER (),1) AS pct
FROM treinamento.fato_financeiro WHERE tipo='despesa' GROUP BY 1 ORDER BY total DESC;
