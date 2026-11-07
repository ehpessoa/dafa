// GERADO por scripts/compute-references.mjs a partir do banco de treinamento (setseed 0.42). Não edite à mão.
export const references = {
  "d02-e1": {
    "desc": "Tamanho e qualidade de fato_pedidos",
    "sql": "SELECT count(*) AS linhas, count(*) - count(DISTINCT pedido_id) AS ids_duplicados, count(*) FILTER (WHERE status IS NULL) AS status_nulos, count(*) FILTER (WHERE canal IS NULL) AS canal_nulos, count(*) FILTER (WHERE data_pedido IS NULL) AS data_nulos FROM treinamento.fato_pedidos",
    "rows": [
      {
        "linhas": 6900,
        "ids_duplicados": 0,
        "status_nulos": 0,
        "canal_nulos": 0,
        "data_nulos": 0
      }
    ]
  },
  "d03-e1": {
    "desc": "Receita por canal (itens, exclui cancelados)",
    "sql": "SELECT p.canal, ROUND(SUM(i.quantidade * i.preco_unitario),2) AS receita FROM treinamento.fato_itens_pedido i JOIN treinamento.fato_pedidos p USING (pedido_id) WHERE p.status <> 'cancelado' GROUP BY 1 ORDER BY 2 DESC",
    "rows": [
      {
        "canal": "site",
        "receita": "1532588.65"
      },
      {
        "canal": "app",
        "receita": "1081912.01"
      },
      {
        "canal": "marketplace",
        "receita": "705696.63"
      },
      {
        "canal": "loja",
        "receita": "361967.57"
      }
    ]
  },
  "d03-e2": {
    "desc": "Receita, custo e margem totais (exclui cancelados)",
    "sql": "SELECT ROUND(SUM(i.quantidade * i.preco_unitario),2) AS receita, ROUND(SUM(i.quantidade*pr.custo),2) AS custo, ROUND(SUM(i.quantidade * i.preco_unitario) - SUM(i.quantidade*pr.custo),2) AS margem, ROUND(100*(SUM(i.quantidade * i.preco_unitario) - SUM(i.quantidade*pr.custo))/SUM(i.quantidade * i.preco_unitario),1) AS margem_pct FROM treinamento.fato_itens_pedido i JOIN treinamento.fato_pedidos p USING (pedido_id) JOIN treinamento.dim_produtos pr USING (produto_id) WHERE p.status <> 'cancelado'",
    "rows": [
      {
        "receita": "3682164.86",
        "custo": "2332752.72",
        "margem": "1349412.14",
        "margem_pct": "36.6"
      }
    ]
  },
  "d03-e3": {
    "desc": "% de entregas com atraso por transportadora (data_entrega - data_envio > prazo_dias)",
    "sql": "SELECT transportadora, count(*) AS entregas, ROUND(100.0*avg((data_entrega-data_envio>prazo_dias)::int),1) AS pct_atraso FROM treinamento.fato_entregas WHERE data_entrega IS NOT NULL GROUP BY 1 ORDER BY 1",
    "rows": [
      {
        "transportadora": "CargaMais",
        "entregas": 1614,
        "pct_atraso": "24.1"
      },
      {
        "transportadora": "EntregaJá",
        "entregas": 1603,
        "pct_atraso": "10.7"
      },
      {
        "transportadora": "RápidoLog",
        "entregas": 1627,
        "pct_atraso": "5.4"
      },
      {
        "transportadora": "TransBrasil",
        "entregas": 1608,
        "pct_atraso": "15.7"
      }
    ]
  },
  "d04-e2": {
    "desc": "Top 5 UF por receita; mês de pico; ticket médio por canal",
    "sql": "SELECT 'uf' AS tipo, p.uf_entrega AS chave, ROUND(SUM(i.quantidade * i.preco_unitario),2) AS valor FROM treinamento.fato_itens_pedido i JOIN treinamento.fato_pedidos p USING (pedido_id) WHERE p.status<>'cancelado' GROUP BY 2 ORDER BY 3 DESC LIMIT 5",
    "rows": [
      {
        "tipo": "uf",
        "chave": "SP",
        "valor": "1165347.24"
      },
      {
        "tipo": "uf",
        "chave": "RJ",
        "valor": "358071.49"
      },
      {
        "tipo": "uf",
        "chave": "MG",
        "valor": "344811.33"
      },
      {
        "tipo": "uf",
        "chave": "PR",
        "valor": "342126.13"
      },
      {
        "tipo": "uf",
        "chave": "DF",
        "valor": "320493.12"
      }
    ]
  },
  "d04-e2b": {
    "desc": "Mês de pico de receita",
    "sql": "SELECT date_trunc('month',p.data_pedido)::date AS mes, ROUND(SUM(i.quantidade * i.preco_unitario),2) AS receita FROM treinamento.fato_itens_pedido i JOIN treinamento.fato_pedidos p USING (pedido_id) WHERE p.status<>'cancelado' GROUP BY 1 ORDER BY 2 DESC LIMIT 1",
    "rows": [
      {
        "mes": "2025-11-01T00:00:00.000Z",
        "receita": "287803.02"
      }
    ]
  },
  "d04-e2c": {
    "desc": "Ticket médio por canal (receita ÷ pedidos)",
    "sql": "SELECT p.canal, ROUND(SUM(i.quantidade * i.preco_unitario)/count(DISTINCT p.pedido_id),2) AS ticket_medio FROM treinamento.fato_itens_pedido i JOIN treinamento.fato_pedidos p USING (pedido_id) WHERE p.status<>'cancelado' GROUP BY 1 ORDER BY 2 DESC",
    "rows": [
      {
        "canal": "site",
        "ticket_medio": "568.26"
      },
      {
        "canal": "loja",
        "ticket_medio": "562.94"
      },
      {
        "canal": "marketplace",
        "ticket_medio": "562.76"
      },
      {
        "canal": "app",
        "ticket_medio": "557.69"
      }
    ]
  },
  "d06-e2": {
    "desc": "Contagem de linhas por tabela",
    "sql": "SELECT 'dim_clientes' t, count(*) FROM treinamento.dim_clientes UNION ALL SELECT 'dim_produtos', count(*) FROM treinamento.dim_produtos UNION ALL SELECT 'fato_pedidos', count(*) FROM treinamento.fato_pedidos UNION ALL SELECT 'fato_itens_pedido', count(*) FROM treinamento.fato_itens_pedido UNION ALL SELECT 'fato_entregas', count(*) FROM treinamento.fato_entregas UNION ALL SELECT 'fato_campanhas', count(*) FROM treinamento.fato_campanhas UNION ALL SELECT 'fato_financeiro', count(*) FROM treinamento.fato_financeiro UNION ALL SELECT 'esporte_partidas', count(*) FROM treinamento.esporte_partidas",
    "rows": [
      {
        "t": "dim_clientes",
        "count": 800
      },
      {
        "t": "dim_produtos",
        "count": 60
      },
      {
        "t": "fato_pedidos",
        "count": 6900
      },
      {
        "t": "fato_itens_pedido",
        "count": 14994
      },
      {
        "t": "fato_entregas",
        "count": 6514
      },
      {
        "t": "fato_campanhas",
        "count": 120
      },
      {
        "t": "fato_financeiro",
        "count": 192
      },
      {
        "t": "esporte_partidas",
        "count": 760
      }
    ]
  },
  "d08-e1": {
    "desc": "Receita por ano (total por mês: 24+ linhas; aqui os totais anuais para conferência)",
    "sql": "SELECT extract(year FROM p.data_pedido)::int AS ano, ROUND(SUM(i.quantidade * i.preco_unitario),2) AS receita, count(DISTINCT date_trunc('month',p.data_pedido)) AS meses FROM treinamento.fato_itens_pedido i JOIN treinamento.fato_pedidos p USING (pedido_id) WHERE p.status<>'cancelado' GROUP BY 1 ORDER BY 1",
    "rows": [
      {
        "ano": 2024,
        "receita": "1598604.89",
        "meses": 12
      },
      {
        "ano": 2025,
        "receita": "2083559.97",
        "meses": 12
      }
    ]
  },
  "d08-e2": {
    "desc": "CTR, CPC e CPA por canal de campanha",
    "sql": "SELECT canal, SUM(investimento) AS investimento, SUM(impressoes) AS impressoes, SUM(cliques) AS cliques, SUM(conversoes) AS conversoes, ROUND(100.0*SUM(cliques)/SUM(impressoes),2) AS ctr_pct, ROUND(SUM(investimento)/SUM(cliques),2) AS cpc, ROUND(SUM(investimento)/SUM(conversoes),2) AS cpa FROM treinamento.fato_campanhas GROUP BY 1 ORDER BY 1",
    "rows": [
      {
        "canal": "Afiliados",
        "investimento": "27436.80",
        "impressoes": 1174810,
        "cliques": 21343,
        "conversoes": 716,
        "ctr_pct": "1.82",
        "cpc": "1.29",
        "cpa": "38.32"
      },
      {
        "canal": "E-mail",
        "investimento": "10169.64",
        "impressoes": 442194,
        "cliques": 17234,
        "conversoes": 1009,
        "ctr_pct": "3.90",
        "cpc": "0.59",
        "cpa": "10.08"
      },
      {
        "canal": "Google Ads",
        "investimento": "49679.57",
        "impressoes": 2161194,
        "cliques": 64105,
        "conversoes": 2457,
        "ctr_pct": "2.97",
        "cpc": "0.77",
        "cpa": "20.22"
      },
      {
        "canal": "Influenciadores",
        "investimento": "37278.27",
        "impressoes": 1702586,
        "cliques": 21703,
        "conversoes": 420,
        "ctr_pct": "1.27",
        "cpc": "1.72",
        "cpa": "88.76"
      },
      {
        "canal": "Meta Ads",
        "investimento": "46618.14",
        "impressoes": 2125705,
        "cliques": 31279,
        "conversoes": 797,
        "ctr_pct": "1.47",
        "cpc": "1.49",
        "cpa": "58.49"
      }
    ]
  },
  "d08-e3": {
    "desc": "Pedidos não cancelados e valor médio (para validar faixas: a soma das faixas deve fechar o total)",
    "sql": "SELECT count(*) AS pedidos, ROUND(avg(v),2) AS valor_medio, ROUND(min(v),2) AS minimo, ROUND(max(v),2) AS maximo FROM ( SELECT p.pedido_id, SUM(i.quantidade * i.preco_unitario) AS v FROM treinamento.fato_itens_pedido i JOIN treinamento.fato_pedidos p USING (pedido_id) WHERE p.status<>'cancelado' GROUP BY 1) t",
    "rows": [
      {
        "pedidos": 6534,
        "valor_medio": "563.54",
        "minimo": "16.61",
        "maximo": "3389.73"
      }
    ]
  },
  "d11-e1": {
    "desc": "Receita, custo e margem % por categoria (exclui cancelados)",
    "sql": "SELECT pr.categoria, ROUND(SUM(i.quantidade * i.preco_unitario),2) AS receita, ROUND(SUM(i.quantidade*pr.custo),2) AS custo, ROUND(100*(SUM(i.quantidade * i.preco_unitario)-SUM(i.quantidade*pr.custo))/SUM(i.quantidade * i.preco_unitario),1) AS margem_pct FROM treinamento.fato_itens_pedido i JOIN treinamento.fato_pedidos p USING (pedido_id) JOIN treinamento.dim_produtos pr USING (produto_id) WHERE p.status<>'cancelado' GROUP BY 1 ORDER BY 2 DESC",
    "rows": [
      {
        "categoria": "Eletrônicos",
        "receita": "1687526.93",
        "custo": "1024802.35",
        "margem_pct": "39.3"
      },
      {
        "categoria": "Esporte",
        "receita": "664915.35",
        "custo": "448718.28",
        "margem_pct": "32.5"
      },
      {
        "categoria": "Casa",
        "receita": "604667.04",
        "custo": "392028.97",
        "margem_pct": "35.2"
      },
      {
        "categoria": "Moda",
        "receita": "342766.60",
        "custo": "225133.56",
        "margem_pct": "34.3"
      },
      {
        "categoria": "Beleza",
        "receita": "250451.69",
        "custo": "156162.23",
        "margem_pct": "37.6"
      },
      {
        "categoria": "Livros",
        "receita": "131837.25",
        "custo": "85907.33",
        "margem_pct": "34.8"
      }
    ]
  },
  "d11-e2": {
    "desc": "Clientes sem nenhum pedido, por canal de aquisição",
    "sql": "SELECT c.canal_aquisicao, count(*) AS clientes_sem_compra FROM treinamento.dim_clientes c WHERE NOT EXISTS (SELECT 1 FROM treinamento.fato_pedidos p WHERE p.cliente_id = c.cliente_id) GROUP BY 1 ORDER BY 1",
    "rows": [
      {
        "canal_aquisicao": "E-mail",
        "clientes_sem_compra": 16
      },
      {
        "canal_aquisicao": "Google Ads",
        "clientes_sem_compra": 22
      },
      {
        "canal_aquisicao": "Indicação",
        "clientes_sem_compra": 11
      },
      {
        "canal_aquisicao": "Influenciadores",
        "clientes_sem_compra": 14
      },
      {
        "canal_aquisicao": "Meta Ads",
        "clientes_sem_compra": 23
      },
      {
        "canal_aquisicao": "Orgânico",
        "clientes_sem_compra": 14
      }
    ]
  },
  "d12-e1": {
    "desc": "Receita mensal: primeiros 3 meses, para conferir mês anterior / var % / acumulado",
    "sql": "SELECT date_trunc('month',p.data_pedido)::date AS mes, ROUND(SUM(i.quantidade * i.preco_unitario),2) AS receita FROM treinamento.fato_itens_pedido i JOIN treinamento.fato_pedidos p USING (pedido_id) WHERE p.status<>'cancelado' GROUP BY 1 ORDER BY 1 LIMIT 3",
    "rows": [
      {
        "mes": "2024-01-01T00:00:00.000Z",
        "receita": "60130.40"
      },
      {
        "mes": "2024-02-01T00:00:00.000Z",
        "receita": "75772.48"
      },
      {
        "mes": "2024-03-01T00:00:00.000Z",
        "receita": "106514.58"
      }
    ]
  },
  "d12-e2": {
    "desc": "Produto nº 1 de cada categoria por receita",
    "sql": "SELECT categoria, nome, receita FROM ( SELECT pr.categoria, pr.nome, ROUND(SUM(i.quantidade * i.preco_unitario),2) AS receita, RANK() OVER (PARTITION BY pr.categoria ORDER BY SUM(i.quantidade * i.preco_unitario) DESC) AS rk FROM treinamento.fato_itens_pedido i JOIN treinamento.fato_pedidos p USING (pedido_id) JOIN treinamento.dim_produtos pr USING (produto_id) WHERE p.status<>'cancelado' GROUP BY 1,2) t WHERE rk = 1 ORDER BY 1",
    "rows": [
      {
        "categoria": "Beleza",
        "nome": "Beleza 01",
        "receita": "37519.45"
      },
      {
        "categoria": "Casa",
        "nome": "Casa 06",
        "receita": "95266.98"
      },
      {
        "categoria": "Eletrônicos",
        "nome": "Eletrônicos 02",
        "receita": "331301.98"
      },
      {
        "categoria": "Esporte",
        "nome": "Esporte 02",
        "receita": "94169.50"
      },
      {
        "categoria": "Livros",
        "nome": "Livros 01",
        "receita": "19393.35"
      },
      {
        "categoria": "Moda",
        "nome": "Moda 08",
        "receita": "63098.93"
      }
    ]
  },
  "d12-e3": {
    "desc": "Líder e último da classificação da temporada 2024 (3 pts vitória, 1 empate)",
    "sql": "WITH j AS (SELECT mandante AS time, gols_mandante gp, gols_visitante gc FROM treinamento.esporte_partidas WHERE temporada=2024 UNION ALL SELECT visitante, gols_visitante, gols_mandante FROM treinamento.esporte_partidas WHERE temporada=2024), t AS (SELECT time, count(*) AS j, SUM(CASE WHEN gp>gc THEN 3 WHEN gp=gc THEN 1 ELSE 0 END) AS pts, SUM(gp-gc) AS saldo, SUM(gp) AS gp FROM j GROUP BY 1) SELECT time, j, pts, saldo, gp FROM t ORDER BY pts DESC, saldo DESC, gp DESC LIMIT 3",
    "rows": [
      {
        "time": "Cometa FC",
        "j": 38,
        "pts": 54,
        "saldo": 7,
        "gp": 29
      },
      {
        "time": "Águias do Norte",
        "j": 38,
        "pts": 54,
        "saldo": 6,
        "gp": 48
      },
      {
        "time": "Leões da Serra",
        "j": 38,
        "pts": 50,
        "saldo": 4,
        "gp": 41
      }
    ]
  },
  "d22-e1": {
    "desc": "Distribuição dos segmentos RFM do template t-sql-rfm (ref. 2025-12-31)",
    "sql": "WITH base AS (SELECT p.cliente_id, (DATE '2025-12-31' - MAX(p.data_pedido)) AS recencia_dias, COUNT(DISTINCT p.pedido_id) AS frequencia, SUM(i.quantidade*i.preco_unitario) AS valor FROM treinamento.fato_pedidos p JOIN treinamento.fato_itens_pedido i USING (pedido_id) WHERE p.status <> 'cancelado' GROUP BY 1), score AS (SELECT *, NTILE(5) OVER (ORDER BY recencia_dias DESC) r, NTILE(5) OVER (ORDER BY frequencia) f, NTILE(5) OVER (ORDER BY valor) m FROM base) SELECT CASE WHEN r>=4 AND f>=4 THEN 'Campeões' WHEN r>=3 AND f>=3 THEN 'Leais' WHEN r<=2 AND f>=3 THEN 'Em risco' WHEN r<=2 THEN 'Hibernando' ELSE 'Potencial' END AS segmento, count(*) AS clientes FROM score GROUP BY 1 ORDER BY 2 DESC",
    "rows": [
      {
        "segmento": "Leais",
        "clientes": 144
      },
      {
        "segmento": "Hibernando",
        "clientes": 142
      },
      {
        "segmento": "Campeões",
        "clientes": 138
      },
      {
        "segmento": "Em risco",
        "clientes": 138
      },
      {
        "segmento": "Potencial",
        "clientes": 138
      }
    ]
  },
  "d25-e1": {
    "desc": "DRE: totais do período (receitas, despesas, resultado)",
    "sql": "SELECT ROUND(SUM(valor) FILTER (WHERE tipo='receita'),2) AS receitas, ROUND(SUM(valor) FILTER (WHERE tipo='despesa'),2) AS despesas, ROUND(SUM(CASE WHEN tipo='receita' THEN valor ELSE -valor END),2) AS resultado, count(DISTINCT date_trunc('month',data)) AS meses FROM treinamento.fato_financeiro",
    "rows": [
      {
        "receitas": "3831073.82",
        "despesas": "3200633.16",
        "resultado": "630440.66",
        "meses": 24
      }
    ]
  }
};
