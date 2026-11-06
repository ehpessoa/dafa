# 🌱 Toolkit Iniciante

> **Objetivo do nível:** Pensar como analista: formular perguntas, organizar dados, dominar Excel, SQL básico e o primeiro relatório no Power BI.
>
> Semanas 1–2 · Dias 1–10 · Excel, SQL I–II, Supabase e Power BI Desktop.

```mermaid
flowchart LR
  D1["D1<br/>Mentalidade analítica e perg"]
  D2["D2<br/>Excel: organização e qualida"]
  D1 --> D2
  D3["D3<br/>Excel: fórmulas essenciais p"]
  D2 --> D3
  D4["D4<br/>Excel: tabelas dinâmicas e s"]
  D3 --> D4
  D5["D5<br/>Excel: gráficos, storytellin"]
  D4 --> D5
  D6["D6<br/>Bancos de dados, Supabase e "]
  D5 --> D6
  D7["D7<br/>SQL I: SELECT, WHERE, ORDER "]
  D6 --> D7
  D8["D8<br/>SQL II: agregações e GROUP B"]
  D7 --> D8
  D9["D9<br/>Power BI Desktop: instalação"]
  D8 --> D9
  D10["D10<br/>Design de relatórios e entre"]
  D9 --> D10
```

---

## Dia 1 · seg 09/11 — Mentalidade analítica e perguntas de negócio

⏱️ 120 min · Depende de: nenhuma

### 1) Conceitual
**Por quê?** Análise sem pergunta vira relatório que ninguém usa. Antes de qualquer ferramenta, você precisa saber transformar um problema vago ("vendas caíram") em uma pergunta mensurável, com métrica, recorte e decisão associada.

**O que você vai aprender**
- O ciclo da análise: Pergunta → Dados → Análise → Insight → Decisão
- Diferença entre dado, métrica, KPI e indicador
- Como escrever uma pergunta SMART de negócio
- Tipos de análise: descritiva, diagnóstica, preditiva e prescritiva

**Cenários de uso**
- **Comercial:** O diretor diz "as vendas do app estão estranhas". Qual métrica, período e comparação transformam isso em pergunta?
- **Marketing:** "Qual canal traz clientes que mais compram em 90 dias?" – métrica, recorte e decisão (onde investir).
- **Esporte:** Um clube quer saber se o público em casa influencia a receita de bilheteria por jogo.

### 2) Conexão com as ferramentas
Hoje não há código. Você aprende a olhar o dataset como um analista: quais tabelas existem, o que cada linha representa (granularidade) e quais perguntas ele consegue responder.

Ferramentas: Papel/Miro/Excel para mapear perguntas · Dataset de treinamento (Excel)

### 3) Exercícios
1. **Dissecando 5 pedidos vagos** — Reescreva 5 pedidos vagos (ex.: "melhorar a logística") como perguntas com métrica, recorte, período e decisão.  
   _Entrega:_ Documento com 5 perguntas SMART
2. **Reconhecimento do dataset** — Abra o Excel do treinamento, descreva em 1 linha cada aba e a granularidade (o que representa uma linha).  
   _Entrega:_ Tabela: aba | granularidade | 2 perguntas possíveis
3. **Catálogo de KPIs** — Escolha 2 áreas (ex.: Comercial e Logística) e liste 4 KPIs de cada com fórmula e fonte.  
   _Entrega:_ Planilha x-kpis preenchida

### 4) Templates
- 📗 [Planilha: catálogo de KPIs por área](../web/public/templates/kpis-areas.xlsx) — KPI, fórmula, fonte, frequência e dono para Comercial, Financeiro, Logística, E-commerce, Esporte e Marketing.
- 📦 [Modelo de relatório de entrega semanal](../toolkit/templates/entrega/c-entrega-semanal.md) — Estrutura para o documento que acompanha cada entrega semanal.

### 5) Recursos
- [Dataset de treinamento (Excel)](../web/public/data/dataset_treinamento.xlsx) — Mesmo dataset do Supabase (clientes, produtos, pedidos, itens, entregas, campanhas, financeiro, partidas) em abas de Excel. Usado nos dias 2–5.

---

## Dia 2 · ter 10/11 — Excel: organização e qualidade dos dados

⏱️ 120 min · Depende de: Dia 1

### 1) Conceitual
**Por quê?** Cerca de 80% do tempo de uma análise vai para preparar dados. Dados bem estruturados (uma linha por registro, uma coluna por atributo) evitam erros e permitem automação.

**O que você vai aprender**
- Princípios de dados "tidy": 1 linha = 1 registro
- Formatar como Tabela (Ctrl+T) e referências estruturadas
- Remover duplicados, tratar vazios, padronizar texto (ARRUMAR, MAIÚSCULA)
- Validação de dados e tipos (data vs. texto vs. número)

**Cenários de uso**
- **Financeiro:** Lançamentos com datas em texto e valores com vírgula/ponto misturados quebram o fechamento mensal.
- **E-commerce:** Cadastro com o mesmo cliente digitado de 3 formas distorce a contagem de clientes únicos.

### 2) Conexão com as ferramentas
Os conceitos de tipos, chaves e duplicidade são os mesmos que você usará em SQL (tipos de coluna, PRIMARY KEY) e Power Query (tipagem). Excel é o laboratório mais rápido para vê-los.

Ferramentas: Microsoft Excel (365 ou 2019+) · Dataset de treinamento (Excel)

### 3) Exercícios
1. **Diagnóstico de qualidade** — Na aba fato_pedidos, conte nulos, duplicados e tipos por coluna. Registre o que encontrou.  
   _Entrega:_ Aba "Diagnostico" com tabela de achados
2. **Limpeza com tabela** — Converta para Tabela, padronize textos e crie coluna calculada "ano_mes".  
   _Entrega:_ Planilha com dados limpos + coluna ano_mes

### 4) Templates
- 📗 [Planilha: painel de vendas (Excel)](../web/public/templates/painel-vendas.xlsx) — Modelo com abas Dados, Fórmulas, Dinâmica e Painel, pronto para colar o dataset.

### 5) Recursos
- [Dataset de treinamento (Excel)](../web/public/data/dataset_treinamento.xlsx) — Mesmo dataset do Supabase (clientes, produtos, pedidos, itens, entregas, campanhas, financeiro, partidas) em abas de Excel. Usado nos dias 2–5.

---

## Dia 3 · qua 11/11 — Excel: fórmulas essenciais para análise

⏱️ 120 min · Depende de: Dia 2

### 1) Conceitual
**Por quê?** Fórmulas permitem responder perguntas de forma repetível e auditável. Dominar condicionais, busca e agregação cobre a maior parte das análises do dia a dia administrativo.

**O que você vai aprender**
- SOMASES, CONT.SES, MÉDIASES
- SE, E, OU, SEERRO
- PROCV / PROCX / ÍNDICE+CORRESP para trazer atributos de outra tabela
- Referências absolutas vs. relativas; nomes de intervalo

**Cenários de uso**
- **Comercial:** Receita por vendedor e meta atingida (SE) para bonificação.
- **Logística:** Percentual de entregas com atraso por transportadora com CONT.SES.
- **Financeiro:** Trazer o centro de custo de uma tabela de de-para com PROCX.

### 2) Conexão com as ferramentas
PROCX equivale a um JOIN em SQL; SOMASES equivale a SUM + WHERE + GROUP BY. Guarde essa tradução: no dia 7 você fará os mesmos cálculos em SQL.

Ferramentas: Excel · Planilha do dia 2 (dados limpos)

### 3) Exercícios
1. **Receita por canal e status** — Calcule com SOMASES a receita por canal (exclua cancelados).  
   _Entrega:_ Tabela de resultados na aba Calculos
2. **PROCX de produtos** — Traga categoria e custo de dim_produtos para os itens e calcule a margem por item.  
   _Entrega:_ Coluna de margem funcionando
3. **Taxa de atraso** — Calcule % de entregas com atraso por transportadora.  
   _Entrega:_ Tabela + fórmula usada

### 4) Templates
- 📗 [Planilha: painel de vendas (Excel)](../web/public/templates/painel-vendas.xlsx) — Modelo com abas Dados, Fórmulas, Dinâmica e Painel, pronto para colar o dataset.

### 5) Recursos
- [Dataset de treinamento (Excel)](../web/public/data/dataset_treinamento.xlsx) — Mesmo dataset do Supabase (clientes, produtos, pedidos, itens, entregas, campanhas, financeiro, partidas) em abas de Excel. Usado nos dias 2–5.

---

## Dia 4 · qui 12/11 — Excel: tabelas dinâmicas e segmentações

⏱️ 120 min · Depende de: Dia 3

### 1) Conceitual
**Por quê?** Tabelas dinâmicas são o "GROUP BY visual": respondem em segundos perguntas de resumo e preparam o terreno para entender o modelo de dados do Power BI.

**O que você vai aprender**
- Linhas, colunas, valores e filtros
- Agrupar datas (mês/trimestre/ano)
- Campos calculados e % do total
- Segmentação de dados e linha do tempo

**Cenários de uso**
- **E-commerce:** Ranking de categorias por receita e participação % no total.
- **Marketing:** ROI por canal de campanha e por mês.
- **Esporte:** Público médio e bilheteria por mandante na temporada.

### 2) Conexão com as ferramentas
Cada arrasto de campo equivale a um GROUP BY. No Power BI, a matriz e os visuais funcionam da mesma forma.

Ferramentas: Excel – Tabela Dinâmica · Dataset

### 3) Exercícios
1. **Tabela dinâmica de receita** — Monte receita por mês x categoria com % do total da linha.  
   _Entrega:_ Aba Dinamica
2. **Perguntas rápidas** — Responda: top 5 UF por receita; mês de pico; canal com maior ticket médio.  
   _Entrega:_ Respostas com print da dinâmica

### 4) Templates
- 📗 [Planilha: painel de vendas (Excel)](../web/public/templates/painel-vendas.xlsx) — Modelo com abas Dados, Fórmulas, Dinâmica e Painel, pronto para colar o dataset.

### 5) Recursos
- [Dataset de treinamento (Excel)](../web/public/data/dataset_treinamento.xlsx) — Mesmo dataset do Supabase (clientes, produtos, pedidos, itens, entregas, campanhas, financeiro, partidas) em abas de Excel. Usado nos dias 2–5.

---

## Dia 5 · sex 13/11 — Excel: gráficos, storytelling e entrega da Semana 1 📦

⏱️ 150 min · Depende de: Dia 4

### 1) Conceitual
**Por quê?** Um bom gráfico encurta a decisão. Hoje você aprende a escolher o gráfico certo e a escrever o título como conclusão, fechando a semana com seu primeiro entregável.

**O que você vai aprender**
- Escolha do gráfico (comparação, evolução, composição, relação)
- Remover ruído: grades, 3D, legendas desnecessárias
- Título-conclusão e destaque de cor
- Estrutura do relatório de entrega

**Cenários de uso**
- **Financeiro:** Evolução do resultado mensal com destaque nos meses negativos.
- **Comercial:** Participação de cada canal na receita (barras, não pizza com 8 fatias).

### 2) Conexão com as ferramentas
As regras de design valem igualmente no Power BI e no matplotlib. Você reutilizará o checklist de qualidade até o dia 30.

Ferramentas: Excel · Template de entrega semanal

### 3) Exercícios
1. **4 gráficos que respondem a 3 perguntas** — Crie 4 gráficos com título-conclusão no painel.  
   _Entrega:_ Aba Painel
2. **Relatório de entrega** — Escreva o relatório seguindo o modelo (pergunta, método, 3 achados, recomendação).  
   _Entrega:_ PDF/Doc do relatório

### 4) Templates
- 📗 [Planilha: painel de vendas (Excel)](../web/public/templates/painel-vendas.xlsx) — Modelo com abas Dados, Fórmulas, Dinâmica e Painel, pronto para colar o dataset.
- ✅ [Checklist de qualidade de relatório/dashboard](../toolkit/templates/checklist/c-relatorio.md) — Use antes de enviar qualquer entrega visual.
- 📦 [Modelo de relatório de entrega semanal](../toolkit/templates/entrega/c-entrega-semanal.md) — Estrutura para o documento que acompanha cada entrega semanal.

### 5) Recursos
- [Dataset de treinamento (Excel)](../web/public/data/dataset_treinamento.xlsx) — Mesmo dataset do Supabase (clientes, produtos, pedidos, itens, entregas, campanhas, financeiro, partidas) em abas de Excel. Usado nos dias 2–5.

> 📦 **Entregável semanal 1:** Painel de vendas em Excel — Planilha com dados limpos, fórmulas, tabela dinâmica e 4 gráficos respondendo a 3 perguntas de negócio, mais o relatório de entrega.

---

## Dia 6 · seg 16/11 — Bancos de dados, Supabase e modelo relacional

⏱️ 120 min · Depende de: Dia 1

### 1) Conceitual
**Por quê?** Dados reais vivem em bancos, não em planilhas soltas. Entender tabelas, chaves e relacionamentos permite pedir, consultar e cruzar dados com segurança e escala.

**O que você vai aprender**
- Tabela, linha, coluna, tipo de dado
- Chave primária e chave estrangeira
- Fato vs. dimensão
- Supabase = Postgres na nuvem; schema treinamento; usuário somente-leitura

**Cenários de uso**
- **Logística:** Pedidos ligados a entregas por pedido_id: onde ficam transportadora e prazo?
- **E-commerce:** Um cliente com muitos pedidos, um pedido com muitos itens (1:N).

### 2) Conexão com as ferramentas
O diagrama ER é o mapa que você usará em SQL (JOINs), Power BI (relacionamentos) e Python (merge).

Ferramentas: Supabase (SQL Editor ou cliente SQL) · Diagrama ER (Mermaid)

### 3) Exercícios
1. **Ler o diagrama ER** — Identifique PK/FK e cardinalidade de cada relacionamento.  
   _Entrega:_ Tabela PK/FK + cardinalidade
2. **Primeiro acesso** — Conecte-se ao Supabase e rode SELECT COUNT(*) em cada tabela.  
   _Entrega:_ Print/ tabela de contagens
3. **Desenhe um modelo seu** — Desenhe o ER de uma área da sua empresa com 4 tabelas.  
   _Entrega:_ Diagrama Mermaid ou imagem

### 4) Templates
- 🧩 [Diagrama ER do banco de análise](../toolkit/templates/diagram/d-er-modelo.md) — Estrutura de dados do schema treinamento (renderiza no GitHub/Mermaid Live).
- 🗄️ [Consultas básicas (SELECT / WHERE / ORDER BY)](../toolkit/templates/sql/t-sql-basico.sql) — Primeiras consultas no schema treinamento.

### 5) Recursos
- [Supabase do programa (banco de análise)]((URL do Supabase informada pelo tutor)) — Projeto Supabase usado como banco de análise (schema "treinamento"). Host de conexão e usuário somente-leitura são informados pelo tutor.
- [Supabase – SQL Editor](https://supabase.com/dashboard) — Painel do Supabase. Peça acesso ao tutor para usar o SQL Editor, ou conecte-se por qualquer cliente SQL com o usuário aluno_leitura.
- [Tutorial SQL do PostgreSQL](https://www.postgresql.org/docs/current/tutorial.html) — Documentação oficial do Postgres (mesmo motor do Supabase).

---

## Dia 7 · ter 17/11 — SQL I: SELECT, WHERE, ORDER BY

⏱️ 120 min · Depende de: Dia 6

### 1) Conceitual
**Por quê?** SQL é a língua franca dos dados. Saber extrair exatamente o que precisa reduz a dependência de TI e evita planilhas gigantes.

**O que você vai aprender**
- SELECT, FROM, WHERE, AND/OR/IN/BETWEEN/LIKE
- ORDER BY, LIMIT, DISTINCT
- Operadores, datas e NULL
- Boas práticas: nomear colunas, comentar, evitar SELECT * em produção

**Cenários de uso**
- **Comercial:** Pedidos do canal marketplace de uma UF no último trimestre.
- **Financeiro:** Lançamentos de despesa acima de R$ 10 mil em um centro de custo.

### 2) Conexão com as ferramentas
Compare cada consulta com o filtro que você fazia no Excel (dia 2–4). O resultado deve bater.

Ferramentas: Supabase SQL Editor · Template t-sql-basico

### 3) Exercícios
1. **10 consultas de filtro** — Escreva 10 consultas com WHERE/ORDER/LIMIT sobre pedidos, clientes e financeiro.  
   _Entrega:_ Arquivo .sql comentado
2. **Bate com o Excel?** — Compare 2 resultados SQL com a planilha e explique diferenças.  
   _Entrega:_ Nota de conferência

### 4) Templates
- 🗄️ [Consultas básicas (SELECT / WHERE / ORDER BY)](../toolkit/templates/sql/t-sql-basico.sql) — Primeiras consultas no schema treinamento.

### 5) Recursos
- [Supabase – SQL Editor](https://supabase.com/dashboard) — Painel do Supabase. Peça acesso ao tutor para usar o SQL Editor, ou conecte-se por qualquer cliente SQL com o usuário aluno_leitura.
- [Tutorial SQL do PostgreSQL](https://www.postgresql.org/docs/current/tutorial.html) — Documentação oficial do Postgres (mesmo motor do Supabase).

---

## Dia 8 · qua 18/11 — SQL II: agregações e GROUP BY

⏱️ 120 min · Depende de: Dia 7

### 1) Conceitual
**Por quê?** Decisões raramente usam linhas individuais; usam totais, médias e comparações por grupo. GROUP BY é o coração da análise de negócio.

**O que você vai aprender**
- COUNT, SUM, AVG, MIN, MAX
- GROUP BY e HAVING
- date_trunc para agrupar por mês
- CASE WHEN para criar categorias

**Cenários de uso**
- **Marketing:** CTR, CPC e CPA por canal e por mês.
- **Esporte:** Média de gols e público por rodada.
- **Logística:** Frete médio por UF e transportadora.

### 2) Conexão com as ferramentas
É a versão em SQL da tabela dinâmica do dia 4. Reproduza uma dinâmica sua em SQL.

Ferramentas: Supabase SQL Editor · Template t-sql-agregacao

### 3) Exercícios
1. **Receita mensal em SQL** — Reproduza em SQL a dinâmica de receita por mês.  
   _Entrega:_ Query + resultado
2. **Métricas de marketing** — Calcule CTR, CPC, CPA e ROAS por canal.  
   _Entrega:_ Query com métricas nomeadas
3. **Faixas com CASE** — Classifique pedidos em faixas de valor e conte por faixa.  
   _Entrega:_ Query + comentário

### 4) Templates
- 🗄️ [Agregações (GROUP BY / HAVING)](../toolkit/templates/sql/t-sql-agregacao.sql) — Totais, médias e rankings por dimensão.

### 5) Recursos
- [Supabase – SQL Editor](https://supabase.com/dashboard) — Painel do Supabase. Peça acesso ao tutor para usar o SQL Editor, ou conecte-se por qualquer cliente SQL com o usuário aluno_leitura.
- [Tutorial SQL do PostgreSQL](https://www.postgresql.org/docs/current/tutorial.html) — Documentação oficial do Postgres (mesmo motor do Supabase).

---

## Dia 9 · qui 19/11 — Power BI Desktop: instalação, conexão e primeiro relatório

⏱️ 150 min · Depende de: Dia 5, Dia 8

### 1) Conceitual
**Por quê?** O Power BI reúne conexão, modelagem e visualização em uma só ferramenta e é o padrão de mercado para dashboards gerenciais interativos.

**O que você vai aprender**
- Instalar o Power BI Desktop
- Obter dados: PostgreSQL (Supabase) e Excel
- Importar vs. DirectQuery
- Visuais básicos: cartão, barras, linhas, segmentações

**Cenários de uso**
- **Comercial:** Dashboard de receita por canal com filtro de ano para a reunião de segunda.
- **E-commerce:** Funil de pedidos por status (pendente → entregue).

### 2) Conexão com as ferramentas
As tabelas do Supabase viram o modelo do Power BI. O que você fez em SQL (agregar) o Power BI faz de forma visual e interativa.

Ferramentas: Power BI Desktop (Windows) · Supabase (Postgres) · Excel

### 3) Exercícios
1. **Instalar e conectar** — Instale o Power BI Desktop e conecte ao Supabase (ou ao Excel se o acesso ao banco não estiver liberado).  
   _Entrega:_ Print da lista de tabelas carregadas
2. **Página 1: Visão executiva** — Crie 4 cartões, 1 linha mensal, 1 barras por categoria e 2 segmentações.  
   _Entrega:_ Arquivo .pbix v1

### 4) Templates
- 📊 [Roteiro .pbix: relatório de vendas (3 páginas)](../toolkit/templates/pbix/b-pbix-guia.md) — Especificação para construir seu arquivo .pbix no Power BI Desktop (e modelo de correção do tutor).
- ✅ [Checklist de qualidade de relatório/dashboard](../toolkit/templates/checklist/c-relatorio.md) — Use antes de enviar qualquer entrega visual.

### 5) Recursos
- [Download do Power BI Desktop](https://www.microsoft.com/en-us/download/details.aspx?id=58494) — Instalador oficial da Microsoft (ou instale pela Microsoft Store: aka.ms/pbidesktopstore, que atualiza sozinho). Somente Windows.
- [Exemplos .pbix oficiais da Microsoft](https://github.com/microsoft/powerbi-desktop-samples) — Repositório oficial com relatórios .pbix de exemplo para abrir, estudar o modelo e os visuais.
- [Power BI – Sample datasets (Microsoft Learn)](https://learn.microsoft.com/power-bi/create-reports/sample-datasets) — Guia oficial para baixar e abrir os exemplos; no Desktop também há Início > "Aprender com dados de exemplo".
- [Supabase do programa (banco de análise)]((URL do Supabase informada pelo tutor)) — Projeto Supabase usado como banco de análise (schema "treinamento"). Host de conexão e usuário somente-leitura são informados pelo tutor.

---

## Dia 10 · sex 20/11 — Design de relatórios e entrega da Semana 2 📦

⏱️ 150 min · Depende de: Dia 9

### 1) Conceitual
**Por quê?** Relatório bonito não é enfeite: layout e hierarquia visual guiam a leitura e evitam interpretações erradas.

**O que você vai aprender**
- Hierarquia visual e grade
- Cores com propósito e acessibilidade
- Interações: filtros cruzados, tooltips, bookmarks
- Validar números contra o SQL

**Cenários de uso**
- **Financeiro:** Painel com receitas x despesas x resultado e alerta de mês negativo.
- **Marketing:** Painel de campanhas: investimento, conversões e CPA por canal.

### 2) Conexão com as ferramentas
Seus 10 SQLs dos dias 7–8 viram a "prova real": os cartões do relatório precisam bater com eles.

Ferramentas: Power BI Desktop · Checklist de qualidade

### 3) Exercícios
1. **Página 2 e refinamento** — Crie a página 2 (Logística ou Marketing) e aplique o checklist em ambas.  
   _Entrega:_ .pbix com 2 páginas
2. **10 consultas SQL finais** — Consolide 10 consultas comentadas e valide 3 totais contra o relatório.  
   _Entrega:_ Arquivo .sql
3. **Relatório da semana** — Preencha o modelo de entrega semanal.  
   _Entrega:_ Documento de entrega

### 4) Templates
- 📊 [Roteiro .pbix: relatório de vendas (3 páginas)](../toolkit/templates/pbix/b-pbix-guia.md) — Especificação para construir seu arquivo .pbix no Power BI Desktop (e modelo de correção do tutor).
- ✅ [Checklist de qualidade de relatório/dashboard](../toolkit/templates/checklist/c-relatorio.md) — Use antes de enviar qualquer entrega visual.
- 📦 [Modelo de relatório de entrega semanal](../toolkit/templates/entrega/c-entrega-semanal.md) — Estrutura para o documento que acompanha cada entrega semanal.
- 🗄️ [Agregações (GROUP BY / HAVING)](../toolkit/templates/sql/t-sql-agregacao.sql) — Totais, médias e rankings por dimensão.

### 5) Recursos
- [Download do Power BI Desktop](https://www.microsoft.com/en-us/download/details.aspx?id=58494) — Instalador oficial da Microsoft (ou instale pela Microsoft Store: aka.ms/pbidesktopstore, que atualiza sozinho). Somente Windows.
- [Microsoft Learn – Power BI](https://learn.microsoft.com/power-bi/) — Trilhas gratuitas e documentação completa do Power BI.

> 📦 **Entregável semanal 2:** Primeiro relatório Power BI + 10 consultas SQL — Arquivo .pbix de 2 páginas conectado ao Supabase e um .sql com 10 consultas comentadas.
