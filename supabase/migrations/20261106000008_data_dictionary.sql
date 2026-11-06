-- Dicionário de dados: novo template, ER completo, e vínculo aos dias 1, 6, 7, 8 e 11 (idempotente).
insert into public.templates (slug, kind, title, description, content, url, filename) values ('x-dicionario', 'excel', 'Dicionário de dados (Excel)', 'Guia das 8 tabelas: o que cada coluna significa, valores possíveis, como as tabelas se ligam e os cuidados de cálculo.', 'Abas: LEIAME · DICIONARIO (cada coluna de cada tabela) · RELACOES (chaves e cardinalidade) · CUIDADOS (receita, margem, cancelados, frete, atraso, ROAS...).', '/templates/dicionario-dados.xlsx', 'dicionario-dados.xlsx') on conflict (slug) do update set kind=excluded.kind, title=excluded.title, description=excluded.description, content=excluded.content, url=excluded.url, filename=excluded.filename;
insert into public.templates (slug, kind, title, description, content, url, filename) values ('d-er-modelo', 'diagram', 'Diagrama ER do banco de análise', 'Estrutura de dados do schema treinamento (renderiza no GitHub/Mermaid Live).', 'erDiagram
  DIM_CLIENTES ||--o{ FATO_PEDIDOS : "faz"
  FATO_PEDIDOS ||--|{ FATO_ITENS_PEDIDO : "contém"
  DIM_PRODUTOS ||--o{ FATO_ITENS_PEDIDO : "vendido em"
  FATO_PEDIDOS ||--o| FATO_ENTREGAS : "gera"
  DIM_CLIENTES { int cliente_id PK
    text nome
    text cidade
    text uf
    text segmento
    text canal_aquisicao
    date data_cadastro }
  DIM_PRODUTOS { int produto_id PK
    text nome
    text categoria
    numeric preco
    numeric custo }
  FATO_PEDIDOS { int pedido_id PK
    int cliente_id FK
    date data_pedido
    text status
    text canal
    text uf_entrega
    numeric frete
    numeric desconto_pct }
  FATO_ITENS_PEDIDO { int item_id PK
    int pedido_id FK
    int produto_id FK
    int quantidade
    numeric preco_unitario }
  FATO_ENTREGAS { int pedido_id PK
    text transportadora
    date data_envio
    int prazo_dias
    date data_entrega }
  FATO_CAMPANHAS { int campanha_id PK
    text canal
    date mes
    numeric investimento
    int impressoes
    int cliques
    int conversoes }
  FATO_FINANCEIRO { int lancamento_id PK
    date data
    text tipo
    text categoria
    text centro_custo
    numeric valor }
  ESPORTE_PARTIDAS { int partida_id PK
    int temporada
    int rodada
    date data_jogo
    text mandante
    text visitante
    int gols_mandante
    int gols_visitante
    int publico
    numeric receita_bilheteria }', null, 'd-er-modelo.mmd') on conflict (slug) do update set kind=excluded.kind, title=excluded.title, description=excluded.description, content=excluded.content, url=excluded.url, filename=excluded.filename;
insert into public.resources (slug, category, title, url, description) values ('r-dataset-xlsx', 'Dados', 'Dataset de treinamento (Excel)', '/data/dataset_treinamento.xlsx', 'Mesmo dataset do Supabase (clientes, produtos, pedidos, itens, entregas, campanhas, financeiro, partidas) em abas de Excel, com a aba DICIONARIO explicando cada coluna. Usado nos dias 1–5.') on conflict (slug) do update set category=excluded.category, title=excluded.title, url=excluded.url, description=excluded.description;
insert into public.sessions (day, level_slug, title, why, learn, scenarios, tools, connection, minutes, scheduled_date, week) values (1, 'iniciante', 'Mentalidade analítica e perguntas de negócio', 'Análise sem pergunta vira relatório que ninguém usa. Antes de qualquer ferramenta, você precisa saber transformar um problema vago ("vendas caíram") em uma pergunta mensurável, com métrica, recorte e decisão associada.', '["O ciclo da análise: Pergunta → Dados → Análise → Insight → Decisão","Diferença entre dado, métrica, KPI e indicador","Como escrever uma pergunta SMART de negócio","Tipos de análise: descritiva, diagnóstica, preditiva e prescritiva"]'::jsonb, '[{"area":"Comercial","text":"O diretor diz \"as vendas do app estão estranhas\". Qual métrica, período e comparação transformam isso em pergunta?"},{"area":"Marketing","text":"\"Qual canal traz clientes que mais compram em 90 dias?\" – métrica, recorte e decisão (onde investir)."},{"area":"Esporte","text":"Um clube quer saber se o público em casa influencia a receita de bilheteria por jogo."}]'::jsonb, '["Papel/Miro/Excel para mapear perguntas","Dataset de treinamento (Excel)"]'::jsonb, 'Hoje não há código. Você aprende a olhar o dataset como um analista: quais tabelas existem, o que cada linha representa (granularidade) e quais perguntas ele consegue responder. O Dicionário de dados é o seu guia: ele explica cada coluna, os valores possíveis e os cuidados de cálculo.', 120, '2026-11-09', 1) on conflict (day) do update set level_slug=excluded.level_slug, title=excluded.title, why=excluded.why, learn=excluded.learn, scenarios=excluded.scenarios, tools=excluded.tools, connection=excluded.connection, minutes=excluded.minutes, scheduled_date=excluded.scheduled_date, week=excluded.week;
insert into public.exercises (id, session_day, position, title, instructions, deliverable) values ('d01-e2', 1, 2, 'Reconhecimento do dataset', 'Abra o Excel do treinamento e use a aba DICIONARIO (ou o Dicionário de dados): descreva em 1 linha cada aba e a granularidade (o que representa uma linha).', 'Tabela: aba | granularidade | 2 perguntas possíveis') on conflict (id) do update set session_day=excluded.session_day, position=excluded.position, title=excluded.title, instructions=excluded.instructions, deliverable=excluded.deliverable;
delete from public.session_templates where session_day in (1,6,7,8,11);
insert into public.session_templates (session_day, template_slug, position) values (1, 'x-dicionario', 0);
insert into public.session_templates (session_day, template_slug, position) values (1, 'x-kpis', 1);
insert into public.session_templates (session_day, template_slug, position) values (1, 'c-entrega-semanal', 2);
insert into public.session_templates (session_day, template_slug, position) values (6, 'd-er-modelo', 0);
insert into public.session_templates (session_day, template_slug, position) values (6, 'x-dicionario', 1);
insert into public.session_templates (session_day, template_slug, position) values (6, 't-sql-basico', 2);
insert into public.session_templates (session_day, template_slug, position) values (7, 'x-dicionario', 0);
insert into public.session_templates (session_day, template_slug, position) values (7, 't-sql-basico', 1);
insert into public.session_templates (session_day, template_slug, position) values (8, 'x-dicionario', 0);
insert into public.session_templates (session_day, template_slug, position) values (8, 't-sql-agregacao', 1);
insert into public.session_templates (session_day, template_slug, position) values (11, 'x-dicionario', 0);
insert into public.session_templates (session_day, template_slug, position) values (11, 't-sql-joins', 1);
