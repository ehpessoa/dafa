-- Pacote DAX: inclui CPA e CTR (idempotente).
insert into public.templates (slug, kind, title, description, content, url, filename) values ('b-dax-pack', 'pbix', 'Pacote de medidas DAX', 'Medidas básicas, de campanhas (CPA e CTR) e de inteligência de tempo.', 'Receita := SUMX(fato_itens_pedido, fato_itens_pedido[quantidade] * fato_itens_pedido[preco_unitario])
Custo := SUMX(fato_itens_pedido, fato_itens_pedido[quantidade] * RELATED(dim_produtos[custo]))
Margem % := DIVIDE([Receita] - [Custo], [Receita])
// Campanhas: fato_campanhas não tem relacionamento com as tabelas de vendas, então as medidas somam as próprias colunas
CPA := DIVIDE(SUM(fato_campanhas[investimento]), SUM(fato_campanhas[conversoes]))
CTR := DIVIDE(SUM(fato_campanhas[cliques]), SUM(fato_campanhas[impressoes]))
Receita YTD := TOTALYTD([Receita], dim_data[data])
Receita Mês Ant := CALCULATE([Receita], DATEADD(dim_data[data], -1, MONTH))
Var % Mês := DIVIDE([Receita] - [Receita Mês Ant], [Receita Mês Ant])
Receita 12M := CALCULATE([Receita], DATESINPERIOD(dim_data[data], MAX(dim_data[data]), -12, MONTH))
% Entregas no Prazo := DIVIDE(CALCULATE(COUNTROWS(fato_entregas), fato_entregas[no_prazo] = TRUE()), COUNTROWS(fato_entregas))', null, 'b-dax-pack.dax') on conflict (slug) do update set kind=excluded.kind, title=excluded.title, description=excluded.description, content=excluded.content, url=excluded.url, filename=excluded.filename;
