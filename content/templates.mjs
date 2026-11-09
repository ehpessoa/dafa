// Biblioteca de templates. kind: sql | prompt | diagram | excel | pbix | checklist | entrega
// `file` define a extensão do arquivo gerado em toolkit/. Para kind=excel, `url` aponta para o .xlsx gerado.
const S = 'treinamento';

export const templates = [
  // ───────────── SQL ─────────────
  { slug: 't-sql-basico', kind: 'sql', file: 'sql', title: 'Consultas básicas (SELECT / WHERE / ORDER BY)',
    description: 'Primeiras consultas no schema treinamento.',
    content: `-- 1) Conhecer a tabela
SELECT * FROM ${S}.fato_pedidos LIMIT 20;

-- 2) Filtrar: pedidos entregues do canal app em 2025
SELECT pedido_id, data_pedido, canal, frete
FROM ${S}.fato_pedidos
WHERE status = 'entregue' AND canal = 'app' AND data_pedido >= '2025-01-01'
ORDER BY data_pedido DESC
LIMIT 50;

-- 3) Valores distintos e contagem
SELECT DISTINCT segmento FROM ${S}.dim_clientes;
SELECT COUNT(*) AS total_clientes FROM ${S}.dim_clientes;

-- TODO (exercício): clientes do segmento 'premium' cadastrados após 2024-06-01, ordenados por data.` },

  { slug: 'c-conexao-banco', kind: 'checklist', file: 'md', title: 'Guia: conectar ao banco do programa (sem conta Supabase)',
    description: 'Passo a passo no DBeaver com o usuário aluno_leitura. Você NÃO faz login no painel do Supabase.',
    content: `# Conectar ao banco do programa

> Você **não** precisa de conta nem de e-mail no Supabase. O login do painel do Supabase é só do tutor.
> Para consultar os dados você usa um programa de SQL e o usuário somente leitura **aluno_leitura**.

## O que o tutor vai te passar
| Campo | Valor |
|---|---|
| Host | (informado pelo tutor, ex.: aws-0-<região>.pooler.supabase.com) |
| Porta | 5432 |
| Banco | postgres |
| Usuário | aluno_leitura.<código-do-projeto> (informado pelo tutor) |
| Senha | (informada pelo tutor, não compartilhe nem salve em arquivos do projeto) |

## Passo a passo (DBeaver Community, Windows/Mac/Linux)
1. Instale o **DBeaver Community** (dbeaver.io/download).
2. Menu **Banco de dados > Nova conexão** e escolha **PostgreSQL**.
3. Na aba **Principal**, preencha Host, Porta, Banco, Usuário e Senha com os dados do tutor.
4. Na aba **SSL**, ative SSL e use o modo **require**. Na primeira vez, o DBeaver baixa o driver PostgreSQL: aceite.
5. Clique em **Testar conexão**. Se aparecer "Conectado", clique em **Concluir**.
6. Clique com o botão direito na conexão > **Editor SQL > Novo script** (atalho Ctrl+]).
7. Rode o teste:

\`\`\`sql
SELECT COUNT(*) FROM treinamento.fato_pedidos;
\`\`\`

## Se der erro
- **Senha/usuário inválidos**: confira o usuário completo (com o ponto e o código do projeto) e peça a senha de novo ao tutor.
- **Timeout/host não encontrado**: use o host do Session pooler informado pelo tutor (não o host "db.").
- **Erro de certificado/SSL**: confirme o modo require e peça orientação ao tutor.
- Você só consegue **ler** (SELECT) as tabelas do schema treinamento; comandos que alteram dados são bloqueados de propósito.

## Sem acesso ao banco?
Use o dataset em Excel (recurso "Dataset de treinamento") e faça os mesmos exercícios com tabelas dinâmicas e fórmulas; avise o tutor.` },

  { slug: 't-sql-agregacao', kind: 'sql', file: 'sql', title: 'Agregações (GROUP BY / HAVING)',
    description: 'Totais, médias e rankings por dimensão.',
    content: `-- Pedidos e frete médio por canal
SELECT canal, COUNT(*) AS pedidos, ROUND(AVG(frete),2) AS frete_medio
FROM ${S}.fato_pedidos
WHERE status <> 'cancelado'
GROUP BY canal
ORDER BY pedidos DESC;

-- Receita por mês (itens)
SELECT date_trunc('month', p.data_pedido)::date AS mes,
       SUM(i.quantidade * i.preco_unitario) AS receita
FROM ${S}.fato_itens_pedido i
JOIN ${S}.fato_pedidos p USING (pedido_id)
WHERE p.status <> 'cancelado'
GROUP BY 1 ORDER BY 1;

-- Estados com mais de 200 pedidos
SELECT uf_entrega, COUNT(*) AS pedidos
FROM ${S}.fato_pedidos
GROUP BY uf_entrega HAVING COUNT(*) > 200
ORDER BY pedidos DESC;` },

  { slug: 't-sql-joins', kind: 'sql', file: 'sql', title: 'JOINs entre fatos e dimensões',
    description: 'INNER/LEFT JOIN para responder perguntas de negócio.',
    content: `-- Receita e margem por categoria
SELECT pr.categoria,
       SUM(i.quantidade * i.preco_unitario)                      AS receita,
       SUM(i.quantidade * (i.preco_unitario - pr.custo))         AS margem,
       ROUND(100.0 * SUM(i.quantidade * (i.preco_unitario - pr.custo))
             / NULLIF(SUM(i.quantidade * i.preco_unitario),0),1) AS margem_pct
FROM ${S}.fato_itens_pedido i
JOIN ${S}.dim_produtos pr USING (produto_id)
JOIN ${S}.fato_pedidos p  USING (pedido_id)
WHERE p.status <> 'cancelado'
GROUP BY pr.categoria ORDER BY receita DESC;

-- Clientes que NUNCA compraram (LEFT JOIN + IS NULL)
SELECT c.cliente_id, c.nome, c.canal_aquisicao
FROM ${S}.dim_clientes c
LEFT JOIN ${S}.fato_pedidos p USING (cliente_id)
WHERE p.pedido_id IS NULL;

-- Logística: atraso por transportadora
SELECT e.transportadora,
       COUNT(*) AS entregas,
       ROUND(100.0 * AVG((e.data_entrega - e.data_envio > e.prazo_dias)::int),1) AS pct_atraso
FROM ${S}.fato_entregas e
WHERE e.data_entrega IS NOT NULL
GROUP BY 1 ORDER BY pct_atraso DESC;` },

  { slug: 't-sql-cte-window', kind: 'sql', file: 'sql', title: 'CTEs, subqueries e window functions',
    description: 'Ranking, acumulado e variação mês a mês.',
    content: `WITH receita_mensal AS (
  SELECT date_trunc('month', p.data_pedido)::date AS mes,
         SUM(i.quantidade * i.preco_unitario) AS receita
  FROM ${S}.fato_itens_pedido i
  JOIN ${S}.fato_pedidos p USING (pedido_id)
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
  FROM ${S}.fato_itens_pedido i JOIN ${S}.dim_produtos pr USING (produto_id)
  GROUP BY pr.categoria, pr.nome
) t WHERE rk <= 3;` },

  { slug: 't-sql-rfm', kind: 'sql', file: 'sql', title: 'RFM e coortes de clientes',
    description: 'Recência, Frequência, Valor e retenção por coorte.',
    content: `-- RFM
WITH base AS (
  SELECT p.cliente_id,
         (DATE '2025-12-31' - MAX(p.data_pedido))              AS recencia_dias,
         COUNT(DISTINCT p.pedido_id)                           AS frequencia,
         SUM(i.quantidade * i.preco_unitario)                  AS valor
  FROM ${S}.fato_pedidos p JOIN ${S}.fato_itens_pedido i USING (pedido_id)
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
  FROM ${S}.fato_pedidos GROUP BY 1)
SELECT pr.coorte,
       (EXTRACT(year FROM age(date_trunc('month',p.data_pedido), pr.coorte))*12
        + EXTRACT(month FROM age(date_trunc('month',p.data_pedido), pr.coorte)))::int AS mes_n,
       COUNT(DISTINCT p.cliente_id) AS clientes
FROM ${S}.fato_pedidos p JOIN primeira pr USING (cliente_id)
GROUP BY 1,2 ORDER BY 1,2;` },

  { slug: 't-sql-financeiro', kind: 'sql', file: 'sql', title: 'DRE simplificada e orçamento x realizado',
    description: 'Resultado mensal e fluxo de caixa acumulado.',
    content: `-- DRE mensal
SELECT date_trunc('month', data)::date AS mes,
       SUM(valor) FILTER (WHERE tipo = 'receita') AS receitas,
       SUM(valor) FILTER (WHERE tipo = 'despesa') AS despesas,
       SUM(CASE WHEN tipo='receita' THEN valor ELSE -valor END) AS resultado
FROM ${S}.fato_financeiro GROUP BY 1 ORDER BY 1;

-- Caixa acumulado
SELECT mes, resultado, SUM(resultado) OVER (ORDER BY mes) AS caixa_acumulado
FROM (SELECT date_trunc('month', data)::date AS mes,
             SUM(CASE WHEN tipo='receita' THEN valor ELSE -valor END) AS resultado
      FROM ${S}.fato_financeiro GROUP BY 1) m;

-- Despesas por centro de custo (participação %)
SELECT centro_custo, SUM(valor) AS total,
       ROUND(100.0*SUM(valor)/SUM(SUM(valor)) OVER (),1) AS pct
FROM ${S}.fato_financeiro WHERE tipo='despesa' GROUP BY 1 ORDER BY total DESC;` },

  // ───────────── Prompts de IA (código Python) ─────────────
  { slug: 'p-pandas-limpeza', kind: 'prompt', file: 'md', title: 'Prompt: limpeza de dados com pandas',
    description: 'Gera código Python para inspecionar e limpar um DataFrame.',
    content: `Você é um analista de dados sênior. Escreva código Python (pandas) COMENTADO EM PORTUGUÊS para:
1. Carregar o arquivo [CAMINHO.csv/xlsx] e mostrar shape, dtypes, nulos por coluna e duplicados.
2. Padronizar nomes de colunas (minúsculas, sem acento, snake_case).
3. Converter colunas de data e numéricas; tratar nulos com a estratégia que eu indicar: [DESCREVA].
4. Remover duplicados pela chave [COLUNA_CHAVE] e listar quantas linhas foram removidas.
5. Salvar o resultado em [saida.csv].

Contexto de negócio: [DESCREVA A ÁREA E O QUE AS COLUNAS SIGNIFICAM].
Regras: use funções pequenas, não use bibliotecas além de pandas, imprima um resumo "antes x depois".
Depois do código, liste 3 riscos/pegadinhas de qualidade de dados que eu devo verificar manualmente.` },

  { slug: 'p-dax', kind: 'prompt', file: 'md', title: 'Prompt: medida DAX com IA',
    description: 'Peça uma medida DAX à IA com o modelo, a regra de negócio e um caso de teste para conferir.',
    content: `Atue como especialista em Power BI e DAX e explique para um profissional administrativo, sem jargão.
Meu modelo (tabelas, colunas e relacionamentos): [EX.: fato_itens_pedido[pedido_id, produto_id, quantidade, preco_unitario] -> dim_produtos[produto_id, custo]; dim_data[data] marcada como tabela de datas e ligada a fato_pedidos[data_pedido]].
Regra de negócio: [EX.: "Receita = quantidade x preço unitário; pedidos cancelados ficam de fora"].
Escreva a medida DAX chamada [NOME DA MEDIDA] que mostra [O QUE ELA DEVE MOSTRAR].
Entregue:
1. a medida, pronta para colar no Power BI;
2. uma explicação em 3 linhas, em português simples, do que ela calcula e de como reage aos filtros (ex.: ano, canal, categoria);
3. um caso de teste: como conferir o resultado com uma consulta SQL;
4. o que pode dar errado (ex.: filtro ignorado, relacionamento inativo, tabela de datas).
Use apenas as tabelas e colunas que informei. Se faltar informação, pergunte antes de escrever.` },

  { slug: 'p-pandas-analise', kind: 'prompt', file: 'md', title: 'Prompt: análise exploratória com pandas',
    description: 'Gera EDA guiada por perguntas de negócio.',
    content: `Atue como analista de dados. Tenho o DataFrame df com as colunas: [LISTA DE COLUNAS E TIPOS].
Pergunta de negócio: [EX.: "Quais categorias têm maior margem e crescem mais rápido?"].
Escreva código pandas que:
- calcule as métricas necessárias (explique a fórmula em comentário);
- apresente uma tabela final ordenada e formatada (R$ e %);
- identifique outliers (IQR) e diga o que fazer com eles;
- termine com um bloco "Conclusões" que gere 3 frases em português executivo a partir dos resultados (use f-strings).
Não invente colunas. Se faltar informação, pergunte antes de codar.` },

  { slug: 'p-viz', kind: 'prompt', file: 'md', title: 'Prompt: gráficos com matplotlib/seaborn',
    description: 'Gráficos claros, com título-conclusão e acessibilidade.',
    content: `Escreva código matplotlib/seaborn para o DataFrame [df] com colunas [..].
Gráfico: [linha/barras/dispersão/heatmap] de [métrica] por [dimensão].
Requisitos: título que seja a CONCLUSÃO (ex.: "App cresce 2x mais que o site"), eixos com unidades, rótulos de dados nos extremos,
paleta com no máximo 4 cores e boa para daltônicos, sem bordas supérfluas, tamanho 10x5, salvar em PNG 200 dpi.
Retorne também uma versão em tabela para quem não enxerga o gráfico.` },

  { slug: 'p-supabase-conexao', kind: 'prompt', file: 'md', title: 'Prompt: conectar Python ao Supabase (Postgres)',
    description: 'Código seguro de conexão somente leitura + leitura para pandas.',
    content: `Escreva um script Python que se conecta ao Postgres do Supabase usando SQLAlchemy + psycopg, lendo as credenciais
de variáveis de ambiente (SUPABASE_DB_HOST, SUPABASE_DB_USER, SUPABASE_DB_PASSWORD, SUPABASE_DB_NAME, SUPABASE_DB_PORT).
Deve: (1) abrir a conexão com sslmode=require; (2) executar uma consulta SQL que eu passo como string e devolver um DataFrame;
(3) tratar erros de conexão com mensagem clara em português; (4) NUNCA imprimir a senha; (5) incluir exemplo lendo
treinamento.fato_pedidos (limite 1000). Explique como criar o arquivo .env e como NÃO versioná-lo no git.` },

  { slug: 'p-forecast', kind: 'prompt', file: 'md', title: 'Prompt: previsão simples de série temporal',
    description: 'Baseline (média móvel / sazonal ingênuo) e Holt-Winters.',
    content: `Tenho uma série mensal de receita (colunas: mes, receita). Escreva código Python que:
1. separe os 3 últimos meses como teste;
2. compare 3 modelos: média móvel 3m, sazonal ingênuo (mesmo mês do ano anterior) e Holt-Winters (statsmodels);
3. calcule MAPE e MAE de cada um no teste e escolha o melhor;
4. projete os próximos 6 meses com faixa de incerteza aproximada;
5. gere gráfico (histórico, ajuste, previsão).
Explique em linguagem simples quando NÃO confiar na previsão.` },

  { slug: 'p-abtest', kind: 'prompt', file: 'md', title: 'Prompt: teste A/B',
    description: 'Teste de proporções, intervalo de confiança e decisão.',
    content: `Rodei um teste A/B de e-mail marketing: grupo A [n_A, conv_A], grupo B [n_B, conv_B].
Escreva código Python (statsmodels) que: calcule taxas de conversão, diferença absoluta e relativa, teste z de duas proporções,
p-valor, intervalo de confiança 95% e poder aproximado. Termine com uma recomendação em 3 linhas para um gestor não técnico
(escale, não escale ou colete mais dados) e liste os vieses possíveis (sazonalidade, tamanho de amostra, múltiplos testes).` },

  { slug: 'p-automacao', kind: 'prompt', file: 'md', title: 'Prompt: automação de relatório semanal',
    description: 'Script que consulta o banco, gera Excel/PNG e pode ser agendado.',
    content: `Crie um script Python "relatorio_semanal.py" que: consulta o Supabase (SQL abaixo), gera um Excel com abas
Resumo/Detalhe formatadas (openpyxl), salva 2 gráficos PNG e escreve um log em arquivo. Deve ter função main(), argparse
com --data-fim, tratamento de erro e código de saída diferente de zero em falha.
SQL: [COLE A QUERY]. Explique como agendar no Agendador de Tarefas do Windows (ou cron) em passos numerados.` },

  { slug: 'p-revisao-codigo', kind: 'prompt', file: 'md', title: 'Prompt: revisar código gerado por IA',
    description: 'Checklist de revisão antes de confiar no resultado.',
    content: `Revise o código abaixo como um analista sênior cético. Responda em tabela (Problema | Linha | Risco | Correção):
- erros de lógica (joins que duplicam linhas, filtros de data, divisão por zero);
- premissas ocultas (moeda, fuso, cancelados incluídos?);
- segurança (credenciais, SQL injection);
- reprodutibilidade (sementes aleatórias, caminhos fixos).
Depois escreva 3 testes rápidos (asserts) que provem que os totais batem com a fonte.
CÓDIGO: [COLE AQUI]` },

  // ───────────── Diagramas (Mermaid) ─────────────
  { slug: 'd-er-modelo', kind: 'diagram', file: 'mmd', title: 'Diagrama ER do banco de análise',
    description: 'Estrutura de dados do schema treinamento (renderiza no GitHub/Mermaid Live).',
    content: `erDiagram
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
    numeric receita_bilheteria }` },

  { slug: 'd-star-schema', kind: 'diagram', file: 'mmd', title: 'Modelo estrela para Power BI',
    description: 'Fato Vendas no centro, dimensões Data, Cliente, Produto, Canal.',
    content: `flowchart LR
  D[dim_data<br/>data, ano, mês, trimestre] --> F
  C[dim_clientes<br/>cliente_id, uf, segmento] --> F
  P[dim_produtos<br/>produto_id, categoria] --> F
  K[dim_canal<br/>canal] --> F
  F((fato_vendas<br/>pedido_id · item_id<br/>quantidade · receita · custo))
  style F fill:#2563eb,color:#fff` },

  { slug: 'd-fluxo-etl', kind: 'diagram', file: 'mmd', title: 'Fluxo ETL: fonte → modelo → relatório',
    description: 'Desenho do fluxo de dados para sua entrega.',
    content: `flowchart LR
  A[(Supabase<br/>Postgres)] -->|Power Query: filtrar,<br/>tipar, mesclar| B[Modelo<br/>estrela]
  B -->|Medidas DAX| C[Relatório<br/>Power BI]
  A -->|SQL + pandas| D[Notebook<br/>Python]
  D -->|PNG / insights| E[Apresentação<br/>executiva]
  C --> E` },

  // ───────────── Excel ─────────────
  { slug: 'x-painel-vendas', kind: 'excel', file: 'xlsx', url: '/templates/painel-vendas.xlsx', title: 'Planilha: painel de vendas (Excel)',
    description: 'Modelo com abas Dados, Fórmulas, Dinâmica e Painel, pronto para colar o dataset.',
    content: 'Abas: LEIAME · Dados (cole a aba fato_pedidos) · Calculos (SOMASES/PROCV de exemplo) · Painel (KPIs + espaço para gráficos).' },
  { slug: 'x-dicionario', kind: 'excel', file: 'xlsx', url: '/templates/dicionario-dados.xlsx', title: 'Dicionário de dados (Excel)',
    description: 'Guia das 8 tabelas: o que cada coluna significa, valores possíveis, como as tabelas se ligam e os cuidados de cálculo.',
    content: 'Abas: LEIAME · DICIONARIO (cada coluna de cada tabela) · RELACOES (chaves e cardinalidade) · CUIDADOS (receita, margem, cancelados, frete, atraso, métricas de campanha...).' },
  { slug: 'x-kpis', kind: 'excel', file: 'xlsx', url: '/templates/kpis-areas.xlsx', title: 'Planilha: catálogo de KPIs por área',
    description: 'KPI, fórmula, fonte, frequência e dono para Comercial, Financeiro, Logística, E-commerce, Esporte e Marketing.',
    content: 'Abas por área com colunas: KPI, definição, fórmula, fonte (tabela/coluna), frequência, meta, dono.' },
  { slug: 'x-dre-fluxo', kind: 'excel', file: 'xlsx', url: '/templates/dre-fluxo-caixa.xlsx', title: 'Planilha: DRE e fluxo de caixa',
    description: 'Modelo com receitas, despesas, resultado e caixa acumulado com fórmulas.',
    content: 'Abas: DRE_Mensal (fórmulas SOMA/ SOMASES) · Fluxo_Caixa (acumulado) · Orcado_vs_Realizado.' },

  // ───────────── Power BI ─────────────
  { slug: 'b-pbix-guia', kind: 'pbix', file: 'md', title: 'Roteiro .pbix: relatório de vendas (3 páginas)',
    description: 'Especificação para construir seu arquivo .pbix no Power BI Desktop (e modelo de correção do tutor).',
    content: `# Roteiro do arquivo vendas.pbix
Fonte: no dia 9, o seu Excel do Painel de vendas (Semana 1). No dia 10, troque a fonte para PostgreSQL (Supabase) → schema treinamento (modo Importar) e confira se os totais continuam iguais.

Página 1 – Visão Executiva
- Cartões: Receita, Margem %, Pedidos, Ticket Médio
- Linha: Receita por mês | Barras: Receita por categoria | Mapa/barras: Receita por UF
- Segmentações: Ano, Canal

Página 2 – Clientes
- Matriz Segmento x Canal, Top 10 clientes, RFM (se já existir)

Página 3 – Logística
- % Entregas no prazo por transportadora, atraso médio (dias)

Medidas mínimas (DAX):
Receita = SUMX(fato_itens_pedido, fato_itens_pedido[quantidade] * fato_itens_pedido[preco_unitario])
Pedidos = DISTINCTCOUNT(fato_pedidos[pedido_id])
Ticket Médio = DIVIDE([Receita], [Pedidos])

Checklist de entrega: nome de abas claro, título-conclusão, cores consistentes, sem poluição, tooltip, bookmark de reset.
Exporte o .pbix e anexe o link (OneDrive/Drive) na submissão.` },
  { slug: 'b-dax-pack', kind: 'pbix', file: 'dax', title: 'Pacote de medidas DAX',
    description: 'Medidas básicas, de campanhas (CPA e CTR) e de inteligência de tempo.',
    content: `Receita := SUMX(fato_itens_pedido, fato_itens_pedido[quantidade] * fato_itens_pedido[preco_unitario])
Custo := SUMX(fato_itens_pedido, fato_itens_pedido[quantidade] * RELATED(dim_produtos[custo]))
Margem % := DIVIDE([Receita] - [Custo], [Receita])
// Campanhas: fato_campanhas não tem relacionamento com as tabelas de vendas, então as medidas somam as próprias colunas
CPA := DIVIDE(SUM(fato_campanhas[investimento]), SUM(fato_campanhas[conversoes]))
CTR := DIVIDE(SUM(fato_campanhas[cliques]), SUM(fato_campanhas[impressoes]))
Receita YTD := TOTALYTD([Receita], dim_data[data])
Receita Mês Ant := CALCULATE([Receita], DATEADD(dim_data[data], -1, MONTH))
Var % Mês := DIVIDE([Receita] - [Receita Mês Ant], [Receita Mês Ant])
Receita 12M := CALCULATE([Receita], DATESINPERIOD(dim_data[data], MAX(dim_data[data]), -12, MONTH))
% Entregas no Prazo := DIVIDE(CALCULATE(COUNTROWS(fato_entregas), fato_entregas[no_prazo] = TRUE()), COUNTROWS(fato_entregas))` },

  // ───────────── Checklists / entregas ─────────────
  { slug: 'c-ia-guia', kind: 'checklist', file: 'md', title: 'Guia rápido: como usar a IA para gerar Python e DAX',
    description: 'Os 5 passos para pedir código à IA, conferir o resultado e registrar o que você fez.',
    content: `A IA escreve rápido, mas erra com confiança. Seu papel é dirigir: dizer o que quer, conferir e registrar. Siga os 5 passos.

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
- Não use um código que você não consegue explicar em uma frase.` },

  { slug: 'c-dax-revisao', kind: 'checklist', file: 'md', title: 'Checklist: revisar uma medida DAX gerada por IA',
    description: 'Seis conferências antes de confiar em uma medida que a IA escreveu.',
    content: `- [ ] A medida usa só tabelas e colunas que existem no meu modelo (a IA não inventou nada)?
- [ ] Ao mudar o filtro (ano, canal, categoria), o número muda como eu espero?
- [ ] Os filtros que deveriam valer (ex.: sem cancelados) estão sendo aplicados?
- [ ] O total bate com a consulta SQL de referência, para pelo menos um mês?
- [ ] Divisões usam DIVIDE (sem erro quando o denominador é zero)?
- [ ] Sei explicar em uma frase o que a medida calcula e registrei o pedido e a correção que fiz?` },

  { slug: 'c-relatorio', kind: 'checklist', file: 'md', title: 'Checklist de qualidade de relatório/dashboard',
    description: 'Use antes de enviar qualquer entrega visual.',
    content: `- [ ] A pergunta de negócio está no topo da página?
- [ ] Cada gráfico tem título-conclusão (não só "Vendas por mês")?
- [ ] Números têm unidade e formato (R$, %, mil/mi)?
- [ ] Máximo de 5–7 visuais por página; alinhados em grade?
- [ ] Paleta limitada (≤ 4 cores) e consistente entre páginas?
- [ ] Filtros funcionam e há botão de limpar?
- [ ] Totais batem com a consulta SQL de referência?
- [ ] Alguém fora da área entendeu em 30 segundos?` },
  { slug: 'c-entrega-semanal', kind: 'entrega', file: 'md', title: 'Modelo de relatório de entrega semanal',
    description: 'Estrutura para o documento que acompanha cada entrega semanal.',
    content: `# Entrega da Semana [N] – [Seu nome]
## 1. Pergunta de negócio
## 2. Dados e método (fonte, filtros, ferramentas)
## 3. Resultados (3 achados com números)
## 4. Recomendações (o que o gestor deve fazer)
## 5. Limitações e próximos passos
## 6. Links dos arquivos (xlsx / pbix / sql / ipynb)
## 7. Autoavaliação (0–10) e dúvidas para o tutor` },
  { slug: 'c-storytelling', kind: 'checklist', file: 'md', title: 'Roteiro de storytelling (5 slides)',
    description: 'Contexto → Problema → Evidência → Recomendação → Próximos passos.',
    content: `1. Contexto (1 frase + 1 número)
2. Problema/Oportunidade (o que está em jogo, em R$)
3. Evidência (1 gráfico principal + 1 de apoio)
4. Recomendação (ação, responsável, prazo, impacto esperado)
5. Riscos e próximos passos
Regra: 1 mensagem por slide, título = conclusão, máximo 30 palavras no corpo.` },
];
