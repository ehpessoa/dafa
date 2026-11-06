-- Guia rápido de IA (c-ia-guia) nos dias 15, 16 e 18 (idempotente).
insert into public.templates (slug, kind, title, description, content, url, filename) values ('c-ia-guia', 'checklist', 'Guia rápido: como usar a IA para gerar Python e DAX', 'Os 5 passos para pedir código à IA, conferir o resultado e registrar o que você fez.', 'A IA escreve rápido, mas erra com confiança. Seu papel é dirigir: dizer o que quer, conferir e registrar. Siga os 5 passos.

1) ESPECIFICAR (você, antes de pedir)
- Escreva a pergunta de negócio em uma frase (ex.: "Qual a margem por categoria?").
- Descreva os dados: nomes das tabelas e colunas, o que cada linha representa e como as tabelas se ligam (use o Dicionário de dados).
- Informe as regras: o que entra e o que sai (ex.: sem pedidos cancelados; o preço já vem com desconto).
- Peça o formato: código pronto para colar, explicação em 3 linhas e como testar.
- Use os modelos de pedido: p-pandas-limpeza e p-pandas-analise (Python) e p-dax (DAX).

2) GERAR
- Cole o pedido. Se a IA fizer perguntas, responda. Se ela inventar uma coluna que não existe, avise e peça de novo.

3) REVISAR (antes de rodar ou colar)
- Todas as tabelas e colunas existem de verdade?
- Os filtros combinam com a regra de negócio (ex.: cancelados)?
- Python: juntou tabelas (merge) sem duplicar linhas? Tratou campos vazios? As datas estão como data?
- DAX: o número muda como esperado ao filtrar por ano ou canal? A divisão usa DIVIDE? A tabela de datas está marcada?

4) TESTAR
- Compare com um número que você já conhece: uma consulta SQL, a tabela dinâmica do Excel ou um total de controle.
- Se não bater, volte ao passo 1 e conte o erro à IA (ex.: "o total deu X, o esperado é Y").

5) REGISTRAR
- Guarde o pedido (v1, v2...), o que a IA devolveu, o que você corrigiu e como validou. Isso faz parte das suas entregas.

CUIDADOS
- Nunca envie dados pessoais reais (nome, CPF, e-mail de clientes) a uma IA que a empresa não aprovou. Nos exercícios, use o dataset fictício.
- Não use um código que você não consegue explicar em uma frase.', null, 'c-ia-guia.md') on conflict (slug) do update set kind=excluded.kind, title=excluded.title, description=excluded.description, content=excluded.content, url=excluded.url, filename=excluded.filename;
insert into public.sessions (day, level_slug, title, why, learn, scenarios, tools, connection, minutes, scheduled_date, week) values (15, 'intermediario', 'DAX I: medidas e contexto – entrega da Semana 3', 'Medidas DAX calculam números corretos em qualquer filtro. Você não precisa decorar a sintaxe: precisa entender o contexto de filtro, pedir a medida certa à IA e conferir o resultado. É o mesmo ciclo especificar → gerar → revisar → testar que você usará no Python.', '["Coluna calculada vs. medida","Contexto de linha e de filtro: o que faz o número mudar","O ciclo para usar IA em código (especificar, gerar, revisar, testar, registrar), o mesmo para DAX e Python: veja o Guia rápido","Revisar a medida da IA: filtros, relacionamentos e conferência com SQL","Escrever à mão as medidas simples (Receita e % do Total) para reconhecer erros","Medidas sobre uma tabela sem relacionamento (fato_campanhas): CPA e CTR"]'::jsonb, '[{"area":"Comercial","text":"Ticket médio e % da receita por canal."},{"area":"Marketing","text":"CTR e CPA por campanha."}]'::jsonb, '["Power BI Desktop","Assistente de IA (Claude)","Prompt p-dax","Pacote de medidas DAX (gabarito)","DAX Guide"]'::jsonb, 'Compare o resultado de cada medida com a query SQL equivalente (dias 8 e 11). Divergências revelam erros de modelo. CPA e CTR vêm de fato_campanhas, que não tem chave em comum com as tabelas de vendas: ela entra no modelo sozinha, sem relacionamento, e suas medidas somam as próprias colunas. O pacote de medidas DAX é o seu gabarito: compare com o que a IA gerou.', 150, '2026-11-27', 3) on conflict (day) do update set level_slug=excluded.level_slug, title=excluded.title, why=excluded.why, learn=excluded.learn, scenarios=excluded.scenarios, tools=excluded.tools, connection=excluded.connection, minutes=excluded.minutes, scheduled_date=excluded.scheduled_date, week=excluded.week;
insert into public.sessions (day, level_slug, title, why, learn, scenarios, tools, connection, minutes, scheduled_date, week) values (18, 'intermediario', 'Python com IA: limpeza e análise com pandas', 'Assistentes de IA aceleram a escrita de código, mas só quem sabe especificar e revisar evita erros silenciosos. Hoje você treina o ciclo especificar → gerar → revisar → testar.', '["Como escrever um bom prompt analítico (contexto, dados, restrições, saída)","groupby, merge, pivot_table","Revisar código da IA (joins, filtros, nulos)","Registrar prompts e versões"]'::jsonb, '[{"area":"Financeiro","text":"Conciliar lançamentos com merge e achar divergências."},{"area":"Marketing","text":"CPA por canal com groupby e formatação em R$."}]'::jsonb, '["Assistente de IA (Claude)","Python + pandas","Templates de prompt"]'::jsonb, 'O prompt carrega o que você aprendeu: pergunta (dia 1), modelo (dia 13) e regras de negócio. Quanto melhor a especificação, melhor o código. Releia o Guia rápido de IA, o mesmo que você usou no DAX (dias 15 e 16).', 150, '2026-12-02', 4) on conflict (day) do update set level_slug=excluded.level_slug, title=excluded.title, why=excluded.why, learn=excluded.learn, scenarios=excluded.scenarios, tools=excluded.tools, connection=excluded.connection, minutes=excluded.minutes, scheduled_date=excluded.scheduled_date, week=excluded.week;
delete from public.session_templates where session_day in (15,16,18);
insert into public.session_templates (session_day, template_slug, position) values (15, 'c-ia-guia', 0);
insert into public.session_templates (session_day, template_slug, position) values (15, 'b-dax-pack', 1);
insert into public.session_templates (session_day, template_slug, position) values (15, 'p-dax', 2);
insert into public.session_templates (session_day, template_slug, position) values (15, 'c-dax-revisao', 3);
insert into public.session_templates (session_day, template_slug, position) values (15, 'd-star-schema', 4);
insert into public.session_templates (session_day, template_slug, position) values (15, 'c-entrega-semanal', 5);
insert into public.session_templates (session_day, template_slug, position) values (16, 'c-ia-guia', 0);
insert into public.session_templates (session_day, template_slug, position) values (16, 'b-dax-pack', 1);
insert into public.session_templates (session_day, template_slug, position) values (16, 'p-dax', 2);
insert into public.session_templates (session_day, template_slug, position) values (16, 'c-dax-revisao', 3);
insert into public.session_templates (session_day, template_slug, position) values (16, 't-sql-cte-window', 4);
insert into public.session_templates (session_day, template_slug, position) values (18, 'c-ia-guia', 0);
insert into public.session_templates (session_day, template_slug, position) values (18, 'p-pandas-limpeza', 1);
insert into public.session_templates (session_day, template_slug, position) values (18, 'p-pandas-analise', 2);
insert into public.session_templates (session_day, template_slug, position) values (18, 'p-revisao-codigo', 3);
