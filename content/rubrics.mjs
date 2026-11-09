// Gabarito de correção: a "solução esperada" de cada um dos 67 exercícios.
// Fonte única para (1) o corretor de IA (Gemini), (2) a tela do tutor e (3) docs/06-correcao-ia.md.
//
// mode:   text  = resposta escrita (a IA consegue verificar tudo pelo texto)
//         sql   = query + resultado colados (a IA confere números contra `refs`)
//         file  = o entregável é um arquivo (.xlsx/.pbix/.pbit/.ipynb/slides…): a IA LÊ o arquivo pelo link (público) e faz uma
//                 PRÉ-análise com nota, mas a decisão final é SEMPRE do tutor (nunca aprova sozinha). Sem arquivo legível
//                 nem descrição suficiente, a entrega também vai ao tutor, sinalizada como evidência insuficiente
// checks: [peso, o que verificar, dimensão]  — pesos somam 100. Dimensões = critérios do programa:
//         num (correção dos números, 35%) · neg (raciocínio de negócio, 25%) · tec (técnica, 20%) · vis (visual, 10%) · rep (reprodutibilidade, 10%)
// refs:   chaves de content/references.mjs (números calculados no banco de treinamento) para conferir resultados
import { references } from './references.mjs';

export const PASS_MARK = 7;
export const DIMS = { num: 'Correção dos números', neg: 'Raciocínio de negócio', tec: 'Técnica e boas práticas', vis: 'Comunicação visual', rep: 'Reprodutibilidade' };

const R = {};
const rb = (id, mode, expected, checks, extra = {}) => { R[id] = { mode, expected, checks, ...extra }; };

// ───────── Semana 1 · Excel ─────────
rb('d01-e1', 'text', 'Cinco pedidos vagos reescritos como perguntas SMART. Cada pergunta traz métrica, recorte (segmento/canal/região), período e a decisão que a resposta apoia. Ex.: "melhorar a logística" → "Qual transportadora teve o maior % de entregas atrasadas nos últimos 6 meses por UF, para decidir onde renegociar contrato?".', [
  [30, 'São 5 perguntas, todas reescritas a partir de pedidos vagos', 'neg'], [30, 'Cada pergunta tem métrica explícita e mensurável', 'neg'],
  [20, 'Cada pergunta tem recorte e período definidos', 'neg'], [20, 'Cada pergunta indica a decisão/ação que a resposta apoia', 'neg']]);
rb('d01-e2', 'text', 'Tabela com uma linha por aba do Excel de treinamento (dim_clientes, dim_produtos, fato_pedidos, fato_itens_pedido, fato_entregas, fato_campanhas, fato_financeiro, esporte_partidas), apoiada na aba DICIONARIO / Dicionário de dados, com a granularidade correta (ex.: fato_pedidos = 1 linha por pedido; fato_itens_pedido = 1 linha por item de pedido) e 2 perguntas possíveis por aba. Não basta copiar o dicionário: as perguntas precisam ser do próprio aluno.', [
  [35, 'Cobre todas (ou quase todas) as abas do dataset', 'num'], [35, 'Granularidade correta e específica ("1 linha = 1 …"), coerente com o dicionário', 'num'],
  [30, 'Duas perguntas plausíveis e respondíveis com os dados da aba (não copiadas do dicionário)', 'neg']]);
rb('d01-e3', 'text', 'Duas áreas com 4 KPIs cada (8 no total). Cada KPI tem fórmula clara (numerador/denominador) e fonte de dados (tabela/coluna). Ex.: Logística — % entregas no prazo = entregas com data_entrega ≤ data_envio+prazo ÷ entregas, fonte fato_entregas.', [
  [30, '8 KPIs (4 por área), de 2 áreas distintas', 'num'], [30, 'Fórmula correta e inequívoca para cada KPI', 'tec'],
  [20, 'Fonte (tabela/coluna) indicada e existente no dataset', 'rep'], [20, 'KPIs relevantes para a área, não duplicados', 'neg']]);

rb('d02-e1', 'text', 'Diagnóstico de qualidade da aba fato_pedidos: contagem de nulos, duplicados e tipos por coluna, registrados numa tabela de achados. O dataset oficial tem 6.900 pedidos, sem IDs duplicados e sem nulos nas colunas principais; o aluno deve reportar o que de fato encontrou (e, se não há problema, dizer isso explicitamente) e como contou.', [
  [40, 'Reporta linhas, nulos, duplicados e tipos por coluna, coerentes com a referência', 'num'], [25, 'Método de contagem descrito (fórmula, filtro ou tabela dinâmica)', 'rep'],
  [20, 'Achados organizados numa tabela legível', 'vis'], [15, 'Indica ação para cada problema (ou conclui que não há)', 'neg']], { refs: ['d02-e1'] });
rb('d02-e2', 'file', 'Dados convertidos em Tabela do Excel (Ctrl+T), textos padronizados (TRIM/MAIÚSCULAS/PRI.MAIÚSCULA, sem espaços extras) e coluna calculada ano_mes (ex.: =TEXTO([@data_pedido];"aaaa-mm")). O aluno descreve os passos e a fórmula usada.', [
  [30, 'Menciona conversão para Tabela do Excel', 'tec'], [30, 'Padronização de texto descrita (TRIM/maiúsculas etc.) com exemplo antes/depois', 'tec'],
  [30, 'Fórmula de ano_mes correta e aplicada à coluna inteira', 'num'], [10, 'Link ou arquivo da planilha informado', 'rep']]);
rb('d03-e1', 'text', 'Receita por canal com SOMASES, excluindo cancelados, usando valor do item (quantidade × preço unitário). Referência (itens, sem cancelados): site 1.532.588,65 · app 1.081.912,01 · marketplace 705.696,63 · loja 361.967,57. Aceitar variação se o aluno documentar outra definição de receita (ex.: incluir frete).', [
  [45, 'Valores por canal conferem com a referência (tolerância 1%) ou usam definição alternativa documentada', 'num'], [25, 'Cancelados excluídos (critério do SOMASES visível)', 'tec'],
  [15, 'Fórmula SOMASES apresentada', 'tec'], [15, 'Tabela de resultados clara, na aba Calculos', 'vis']], { refs: ['d03-e1'] });
rb('d03-e2', 'file', 'Coluna de margem por item via PROCX/XLOOKUP em dim_produtos trazendo categoria e custo; margem = (preço_unitário − custo) × quantidade (ou %). Conferência sugerida: margem total ≈ 36,6% sobre a receita (sem cancelados).', [
  [35, 'PROCX/XLOOKUP correto (chave produto_id, retorno categoria e custo)', 'tec'], [35, 'Fórmula de margem correta (unitária ou total) com custo × quantidade', 'num'],
  [20, 'Margem total/percentual coerente com a referência', 'num'], [10, 'Sem erros #N/D e fórmula copiada para toda a coluna', 'rep']], { refs: ['d03-e2'] });
rb('d03-e3', 'text', '% de entregas com atraso por transportadora = entregas com (data_entrega − data_envio) > prazo_dias ÷ entregas entregues. Referência: CargaMais 24,1% · TransBrasil 15,7% · EntregaJá 10,7% · RápidoLog 5,4%.', [
  [50, 'Percentuais por transportadora conferem com a referência (±0,5 p.p.)', 'num'], [25, 'Fórmula de atraso mostrada e correta (compara dias de entrega com prazo)', 'tec'],
  [15, 'Considera apenas entregas já realizadas (data_entrega preenchida)', 'tec'], [10, 'Tabela legível com a transportadora pior destacada', 'vis']], { refs: ['d03-e3'] });
rb('d04-e1', 'file', 'Tabela dinâmica de receita com linhas = mês, colunas = categoria, valor = soma da receita e uma segunda exibição "% do total da linha". O aluno descreve campos usados e cola/descreve o resultado.', [
  [30, 'Campos corretos: mês nas linhas, categoria nas colunas, soma de receita', 'tec'], [30, '% do total da linha configurado (Mostrar valores como)', 'tec'],
  [25, 'Resultado coerente (cada linha soma 100%; categoria líder = Eletrônicos)', 'num'], [15, 'Aba Dinamica identificada / arquivo informado', 'rep']]);
rb('d04-e2', 'text', 'Respostas: top 5 UF por receita — SP 1.165.347 · RJ 358.071 · MG 344.811 · PR 342.126 · DF 320.493; mês de pico — nov/2025 (≈287.803); canal com maior ticket médio — site (≈568,26; diferenças entre canais são pequenas). Com print/descrição da dinâmica.', [
  [40, 'Top 5 UF corretas e na ordem', 'num'], [25, 'Mês de pico correto', 'num'], [20, 'Canal de maior ticket médio correto (ticket = receita ÷ pedidos)', 'num'], [15, 'Evidência da dinâmica (print ou descrição dos campos)', 'rep']], { refs: ['d04-e2', 'd04-e2b', 'd04-e2c'] });
rb('d05-e1', 'file', 'Painel com 4 gráficos que respondem a 3 perguntas de negócio; cada gráfico com título-conclusão (ex.: "Eletrônicos geram 46% da receita"), eixos legíveis, sem excesso de cores. O aluno lista as 3 perguntas e o título de cada gráfico.', [
  [25, 'Quatro gráficos descritos, vinculados a 3 perguntas explícitas', 'neg'], [30, 'Títulos são conclusões (afirmam o insight), não rótulos', 'vis'],
  [20, 'Tipo de gráfico adequado a cada pergunta', 'vis'], [15, 'Insights consistentes com os dados (ex.: SP lidera, pico em nov)', 'num'], [10, 'Arquivo/aba Painel informado', 'rep']]);
rb('d05-e2', 'text', 'Relatório no modelo de entrega semanal: pergunta, método, 3 achados quantificados, recomendação acionável e limitações. Linguagem executiva, curto.', [
  [20, 'Pergunta de negócio clara', 'neg'], [20, 'Método descrito de forma reproduzível', 'rep'], [30, 'Três achados com números', 'num'], [20, 'Recomendação concreta ligada aos achados', 'neg'], [10, 'Organização e clareza do texto', 'vis']]);

// ───────── Semana 2 · SQL e Power BI ─────────
rb('d06-e1', 'text', 'Tabela com cada relacionamento do ER: PK de cada tabela e FK correspondente, com cardinalidade 1:N. Ex.: dim_clientes.cliente_id (PK) 1—N fato_pedidos.cliente_id (FK); fato_pedidos 1—N fato_itens_pedido; dim_produtos 1—N fato_itens_pedido; fato_pedidos 1—1 fato_entregas.', [
  [40, 'PKs corretas para todas as tabelas', 'num'], [40, 'FKs e cardinalidades corretas', 'num'], [20, 'Organização em tabela clara', 'vis']]);
rb('d06-e2', 'text', 'Conexão feita pelo guia "conectar ao banco" (DBeaver + usuário aluno_leitura) e SELECT COUNT(*) em cada tabela com as contagens: dim_clientes 800 · dim_produtos 60 · fato_pedidos 6.900 · fato_itens_pedido 14.994 · fato_entregas 6.514 · fato_campanhas 120 · fato_financeiro 192 · esporte_partidas 760.', [
  [70, 'Contagens conferem com a referência', 'num'], [15, 'Mostra a(s) query(s) usada(s) (e que conectou como aluno_leitura, sem expor a senha)', 'rep'], [15, 'Apresenta em tabela/print legível', 'vis']], { refs: ['d06-e2'] });
rb('d06-e3', 'text', 'Modelo ER de uma área da empresa do aluno com 4 tabelas, PK/FK e relacionamentos coerentes (diagrama Mermaid ou imagem). Granularidade de cada tabela explicada.', [
  [30, 'Quatro tabelas com PK definidas', 'tec'], [30, 'Relacionamentos e cardinalidades coerentes', 'tec'], [25, 'Modelo realista para a área descrita', 'neg'], [15, 'Diagrama legível (Mermaid/imagem)', 'vis']]);
rb('d07-e1', 'sql', 'Dez consultas com WHERE/ORDER BY/LIMIT sobre pedidos, clientes e financeiro (schema treinamento), sintaticamente corretas e comentadas, cada uma respondendo a uma pergunta distinta.', [
  [30, 'São 10 consultas distintas', 'num'], [30, 'Usam WHERE, ORDER BY e LIMIT corretamente', 'tec'], [20, 'Cobrem pedidos, clientes e financeiro', 'neg'], [20, 'Comentadas (o que cada uma responde)', 'rep']]);
rb('d07-e2', 'text', 'Comparação de 2 resultados do SQL com a planilha, explicando diferenças com causas plausíveis (cancelados incluídos/excluídos, duplicidade, tipo de data, arredondamento).', [
  [35, 'Dois resultados comparados lado a lado', 'num'], [40, 'Diferença explicada com causa técnica plausível (ou confirma igualdade)', 'tec'], [25, 'Conclusão sobre qual fonte confiar', 'neg']]);
rb('d08-e1', 'sql', 'SELECT date_trunc(\'month\', data_pedido), SUM(quantidade*preco_unitario) via JOIN itens↔pedidos, excluindo cancelados, GROUP BY mês. Totais de referência: 2024 = 1.598.604,89 · 2025 = 2.083.559,97 (24 meses). Janeiro/2024 = 60.130,40.', [
  [50, 'Resultado por mês coerente com a referência (totais anuais ±1%)', 'num'], [25, 'JOIN e agregação corretos, cancelados tratados', 'tec'], [15, 'Ordenação por mês', 'tec'], [10, 'Query e resultado apresentados', 'rep']], { refs: ['d08-e1', 'd12-e1'] });
rb('d08-e2', 'sql', 'CTR = cliques ÷ impressões; CPC = investimento ÷ cliques; CPA = investimento ÷ conversões, por canal de fato_campanhas (o ROAS não faz parte do exercício: a tabela não tem receita). Referência: E-mail CTR 3,90% CPC 0,59 CPA 10,08 · Google Ads 2,97% / 0,77 / 20,22 · Meta Ads 1,47% / 1,49 / 58,49 · Afiliados 1,82% / 1,29 / 38,32 · Influenciadores 1,27% / 1,72 / 88,76.', [
  [55, 'CTR, CPC e CPA por canal conferem com a referência', 'num'], [20, 'Colunas com nomes claros (alias), agregando antes de dividir (SUM/SUM, não média de razões) e divisão segura', 'tec'], [15, 'Leitura breve (melhor/pior canal, ex.: E-mail mais eficiente, Influenciadores mais caro por conversão)', 'neg'], [10, 'Query apresentada', 'rep']], { refs: ['d08-e2'] });
rb('d08-e3', 'sql', 'CASE WHEN classificando o valor total do pedido em faixas (ex.: até 200, 200–600, 600–1.200, acima de 1.200) e COUNT por faixa. A soma das faixas deve fechar 6.534 pedidos não cancelados (valor médio ≈ 563,54).', [
  [40, 'Faixas definidas sem lacunas/sobreposições', 'tec'], [35, 'Soma das contagens = total de pedidos considerados (6.534 sem cancelados, ou justificativa)', 'num'], [25, 'Comentário interpretando a distribuição', 'neg']], { refs: ['d08-e3'] });
rb('d09-e1', 'file', 'Power BI Desktop instalado e o Excel do Painel de vendas (Semana 1) importado. O aluno lista as tabelas/abas carregadas e confere o tipo de cada coluna (datas como Data, valores como Número decimal, textos como Texto).', [
  [40, 'Lista as tabelas/abas do Excel carregadas no Power BI', 'num'], [35, 'Confere e cita os tipos das colunas (data, número, texto) e corrige o que veio errado', 'tec'], [15, 'Indica que a fonte é o Excel da Semana 1', 'rep'], [10, 'Print ou descrição do Navegador/Modelo', 'vis']]);
rb('d09-e2', 'file', 'Página "Visão executiva" a partir do Excel: 4 cartões (ex.: receita, pedidos, ticket médio, margem), 1 gráfico de linha mensal, 1 de barras por categoria e 2 segmentações, e uma comparação com o painel da Semana 1 (os totais devem bater). O aluno descreve cada visual e as medidas.', [
  [35, 'Quatro cartões + linha mensal + barras por categoria + 2 segmentações descritos', 'tec'], [30, 'Comparação com o painel do Excel mostrando totais iguais (ou explicando a diferença)', 'num'], [20, 'Layout e títulos claros', 'vis'], [15, 'Arquivo .pbix informado', 'rep']]);
rb('d10-e1', 'file', 'Fonte do relatório trocada do Excel para o Supabase (Obter dados > PostgreSQL, usuário aluno_leitura) e os cartões da página 1 continuam batendo. Entrega: totais antes (Excel) e depois (Supabase) lado a lado — ex.: receita total ≈ 3.682.164,86 e 6.534 pedidos não cancelados, ou a diferença explicada (ex.: cancelados, tipos).', [
  [45, 'Totais antes e depois apresentados lado a lado e coerentes', 'num'], [25, 'Descreve a troca de fonte (PostgreSQL/Supabase) e o que precisou ajustar (tipos, nomes, relacionamentos)', 'tec'], [20, 'Explica qualquer diferença entre Excel e Supabase', 'neg'], [10, 'Print ou arquivo informado, sem expor a senha', 'rep']], { refs: ['d03-e2', 'd08-e3'] });
rb('d10-e2', 'file', 'Segunda página (Logística ou Marketing) e checklist de qualidade aplicado nas duas páginas (c-relatorio): títulos, cores, alinhamento, rótulos, contraste. O aluno lista o que ajustou.', [
  [35, 'Página 2 com visuais coerentes com Logística ou Marketing', 'tec'], [35, 'Checklist aplicado com itens ajustados listados', 'vis'], [20, 'Métricas corretas (ex.: atraso por transportadora, CPA por canal)', 'num'], [10, '.pbix informado', 'rep']]);
rb('d10-e3', 'sql', 'Arquivo .sql com 10 consultas comentadas e 3 totais validados contra o relatório (ex.: receita total ≈ 3.682.164,86; pedidos não cancelados 6.534; 6.900 pedidos totais).', [
  [30, '10 consultas comentadas e corretas', 'tec'], [40, 'Três totais validados contra o relatório, com valores coerentes', 'num'], [20, 'Organização do arquivo (cabeçalhos, comentários)', 'rep'], [10, 'Conclusão da validação', 'neg']], { refs: ['d03-e2', 'd08-e3'] });
rb('d10-e4', 'text', 'Entrega semanal no modelo: pergunta, método, 3 achados quantificados, recomendação, links para .pbix e .sql.', [
  [25, 'Modelo preenchido por completo', 'rep'], [30, 'Achados com números do dataset', 'num'], [25, 'Recomendação acionável', 'neg'], [20, 'Links dos artefatos', 'rep']]);

// ───────── Semana 3 · Intermediário ─────────
rb('d11-e1', 'sql', 'JOIN itens → pedidos → produtos, sem cancelados: receita, custo (quantidade × custo) e margem % por categoria. Referência: Eletrônicos 1.687.526,93 / 1.024.802,35 / 39,3% · Esporte 664.915,35 / 448.718,28 / 32,5% · Casa 604.667,04 / 392.028,97 / 35,2% · Moda 342.766,60 / 225.133,56 / 34,3% · Beleza 250.451,69 / 156.162,23 / 37,6% · Livros 131.837,25 / 85.907,33 / 34,8%.', [
  [50, 'Receita, custo e margem % por categoria conferem (±1%)', 'num'], [25, 'JOINs corretos e filtro de cancelados', 'tec'], [15, 'Margem % = (receita − custo) ÷ receita', 'tec'], [10, 'Query validada/comentada', 'rep']], { refs: ['d11-e1'] });
rb('d11-e2', 'sql', 'Anti-join (LEFT JOIN … IS NULL ou NOT EXISTS) listando clientes sem pedidos agrupados por canal_aquisicao. Referência: E-mail 16 · Google Ads 22 · Indicação 11 · Influenciadores 14 · Meta Ads 23 · Orgânico 14 (total 100).', [
  [50, 'Contagens por canal conferem', 'num'], [30, 'Anti-join correto (não usa JOIN interno nem NOT IN com NULL)', 'tec'], [20, 'Query + contagem apresentados', 'rep']], { refs: ['d11-e2'] });
rb('d11-e3', 'text', 'Demonstração de que o JOIN não duplicou linhas: COUNT antes e depois, COUNT(DISTINCT pedido_id), e explicação de que o JOIN itens→pedidos preserva a granularidade de item (14.994 itens).', [
  [40, 'Contagens antes/depois comparadas', 'num'], [35, 'Explica a granularidade e por que não há duplicação (ou como detectou e corrigiu)', 'tec'], [25, 'Conclusão clara', 'neg']], { refs: ['d06-e2'] });
rb('d12-e1', 'sql', 'CTE mensal + LAG(receita) para mês anterior, var % = (atual − anterior) ÷ anterior e SUM() OVER (ORDER BY mês) para acumulado. Jan/24 60.130,40 → Fev/24 75.772,48 (+26,0%) → Mar/24 106.514,58 (+40,6%).', [
  [40, 'Valores mensais e variações conferem com a referência', 'num'], [30, 'LAG e SUM OVER corretos', 'tec'], [15, 'Primeiro mês sem anterior tratado (NULL)', 'tec'], [15, 'Query legível com CTE', 'rep']], { refs: ['d12-e1'] });
rb('d12-e2', 'sql', 'RANK()/ROW_NUMBER() OVER (PARTITION BY categoria ORDER BY receita DESC) filtrando rank ≤ 3. Nº 1 por categoria: Beleza 01 · Casa 06 · Eletrônicos 02 · Esporte 02 · Livros 01 · Moda 08.', [
  [45, 'Top 1 de cada categoria confere', 'num'], [35, 'PARTITION BY e filtro ≤ 3 corretos (3 por categoria)', 'tec'], [20, 'Query organizada', 'rep']], { refs: ['d12-e2'] });
rb('d12-e3', 'sql', 'Classificação de uma temporada de esporte_partidas: união mandante/visitante, 3 pts vitória, 1 empate, ordenação por pontos, saldo, gols pró. Temporada 2024: 1º Cometa FC 54 pts (saldo +7, 29 GP), 2º Águias do Norte 54 pts (saldo +6), 3º Leões da Serra 50 pts; 38 jogos por time.', [
  [45, 'Pontos, saldo e posição dos primeiros colocados conferem', 'num'], [30, 'Soma pontos de mandante e visitante (UNION ALL) corretamente', 'tec'], [15, 'Critérios de desempate explícitos', 'tec'], [10, 'Prints/resultado', 'rep']], { refs: ['d12-e3'] });
rb('d13-e1', 'text', 'Modelo estrela: fato_itens_pedido (granularidade declarada: 1 linha por item de pedido) no centro; dimensões dim_data, dim_clientes, dim_produtos (e opcionalmente canal/transportadora); relacionamentos 1:N das dimensões para o fato.', [
  [35, 'Fato central com granularidade declarada', 'tec'], [35, 'Dimensões corretas ligadas por chaves', 'tec'], [15, 'Sem relacionamentos fato↔fato', 'tec'], [15, 'Diagrama legível', 'vis']]);
rb('d13-e2', 'file', 'No Power BI: tabelas importadas, dim_data criada (CALENDAR/CALENDARAUTO) e relacionamentos 1:N com direção única das dimensões para o fato, chave de data marcada. O aluno descreve o modelo.', [
  [35, 'dim_data criada e marcada como tabela de datas', 'tec'], [35, 'Relacionamentos 1:N corretos, dimensões → fato', 'tec'], [20, 'Tabelas do modelo completas', 'num'], [10, 'Print ou arquivo informado', 'rep']]);
rb('d14-e1', 'file', 'Em fato_entregas: no_prazo (booleano: data_entrega ≤ data_envio + prazo_dias) e dias_atraso (max(0, data_entrega − data_envio − prazo_dias)), com as etapas aplicadas do Power Query documentadas na ordem.', [
  [40, 'Lógica de no_prazo e dias_atraso correta (inclui tratamento de data_entrega nula)', 'num'], [35, 'Etapas aplicadas listadas e nomeadas', 'rep'], [25, 'Tipos de dados corretos', 'tec']]);
rb('d14-e2', 'text', 'Diagrama do fluxo ETL: fonte (Supabase/Excel) → transformação (Power Query) → modelo (estrela) → relatório (Power BI), com o que acontece em cada etapa.', [
  [40, 'As 4 etapas presentes na ordem correta', 'tec'], [35, 'Transformações concretas citadas (ex.: no_prazo, tipos)', 'neg'], [25, 'Diagrama legível', 'vis']]);
rb('d15-e1', 'file', 'Oito medidas DAX: o aluno escreve Receita e % do Total (DIVIDE com ALL/ALLSELECTED); a IA (prompt p-dax) gera Custo, Margem % (DIVIDE), Pedidos (DISTINCTCOUNT), Ticket Médio (DIVIDE), CPA (investimento ÷ conversões) e CTR (cliques ÷ impressões), estas duas sobre fato_campanhas importada SEM relacionamento. Cada pedido feito à IA é registrado. Valores gerais esperados: receita ≈ 3.682.164,86; margem ≈ 36,6%; 6.534 pedidos; CPA e CTR por canal conforme a referência do dia 8.', [
  [25, 'As 8 medidas presentes com nomes claros (CTR no lugar de ROAS)', 'num'], [30, 'DAX correto (DIVIDE, DISTINCTCOUNT, ALL; CPA/CTR somando fato_campanhas sem depender de relacionamento)', 'tec'], [20, 'Valores exibidos coerentes com a referência', 'num'], [15, 'Pedidos feitos à IA registrados (prompt usado e resposta/ajuste)', 'rep'], [10, 'Prints / arquivo', 'vis']], { refs: ['d03-e2', 'd08-e3', 'd08-e2'] });
rb('d15-e2', 'text', 'Tabela de conferência provando que 3 medidas DAX batem com SQL (valor DAX, valor SQL, diferença), com a query usada, mais o checklist de revisão de IA: pelo menos 1 correção ou ponto de atenção real encontrado numa medida gerada pela IA.', [
  [35, 'Três medidas comparadas com SQL e valores coerentes', 'num'], [20, 'Queries SQL mostradas', 'rep'], [20, 'Explica diferenças ou confirma igualdade', 'tec'], [25, 'Checklist de revisão com ao menos 1 correção/ponto de atenção concreto numa medida da IA', 'tec']], { refs: ['d03-e2', 'd08-e3'] });
rb('d16-e1', 'file', 'Medidas de tempo geradas com a IA (prompt p-dax) sobre dim_data: YTD (TOTALYTD/DATESYTD), Mês anterior (DATEADD/PREVIOUSMONTH), Var % (DIVIDE) e 12M (DATESINPERIOD), aplicadas ao modelo e exibidas em gráfico de linha + cartões, com os pedidos à IA e as correções feitas registrados.', [
  [40, 'Quatro medidas de tempo corretas', 'tec'], [15, 'Usa tabela de datas marcada', 'tec'], [20, 'Visual com linha + cartões', 'vis'], [15, 'Pedidos à IA e correções registrados', 'rep'], [10, 'Arquivo/print', 'rep']]);
rb('d16-e2', 'text', 'Mês escolhido com valores do DAX confirmados por SQL (ex.: receita de jan/2024 = 60.130,40, fev/2024 = 75.772,48), com a query e a diferença.', [
  [50, 'Valores conferem com a referência para o mês escolhido', 'num'], [30, 'Query de validação mostrada', 'rep'], [20, 'Conclusão da validação', 'neg']], { refs: ['d12-e1'] });
rb('d17-e1', 'text', 'Python instalado, venv criada e script que imprime a versão do Python e o shape do dataset (o dataset de pedidos tem 6.900 linhas). Print do terminal.', [
  [35, 'Versão do Python ≥ 3.12 exibida', 'tec'], [35, 'Shape coerente com o dataset carregado (ex.: 6900 linhas)', 'num'], [30, 'Uso de venv evidenciado', 'rep']]);
rb('d17-e2', 'sql', 'Script .py comentado que carrega o Excel e responde 5 perguntas simples com pandas (contagem, soma, groupby, top N, média), com os resultados.', [
  [40, 'Cinco respostas corretas e plausíveis (conferir com a referência quando aplicável)', 'num'], [30, 'Uso adequado de pandas (read_excel, groupby, sort_values)', 'tec'], [30, 'Código comentado e executável', 'rep']], { refs: ['d03-e1', 'd04-e2c'] });
rb('d18-e1', 'text', 'Uso do prompt de limpeza, código executado e log de revisão listando 2 correções que o aluno precisou fazer no código da IA (ex.: parse de datas, chave errada).', [
  [30, 'Código resultante apresentado', 'rep'], [40, 'Duas correções reais descritas (o que a IA errou, como foi corrigido)', 'tec'], [30, 'Validação do resultado (contagem, amostra)', 'num']]);
rb('d18-e2', 'sql', 'Análise de margem por categoria em pandas e comparação com a SQL do dia 11: margem % deve bater (Eletrônicos 39,3% · Beleza 37,6% · Casa 35,2% · Livros 34,8% · Moda 34,3% · Esporte 32,5%).', [
  [50, 'Margem por categoria confere com a referência', 'num'], [25, 'Comparação explícita com a SQL', 'tec'], [25, 'Script comentado e reproduzível', 'rep']], { refs: ['d11-e1'] });
rb('d19-e1', 'file', 'Histograma, boxplot e dispersão com título-conclusão, rótulos de eixo e script que gera os PNGs. O aluno descreve cada gráfico e o insight.', [
  [30, 'Três gráficos adequados (distribuição, outliers, relação)', 'tec'], [30, 'Títulos-conclusão e rótulos', 'vis'], [25, 'Insights corretos e plausíveis', 'neg'], [15, 'Script/PNGs informados', 'rep']]);
rb('d19-e2', 'text', 'Outliers de frete identificados com método explícito (IQR 1,5× ou z-score) e proposta de tratamento justificada (manter, winsorizar, investigar), com contagem.', [
  [35, 'Método de detecção correto e explícito', 'tec'], [25, 'Quantidade/limites de outliers reportados', 'num'], [40, 'Tratamento justificado pelo contexto de negócio', 'neg']]);
rb('d20-e1', 'text', 'Conexão ao Supabase sem expor a senha: variáveis de ambiente/.env fora do Git (.gitignore) e .env.example sem segredos; script lê fato_pedidos (6.900 linhas). Nada de senha no código.', [
  [45, 'Credenciais via variável de ambiente/.env, nunca no código', 'tec'], [25, '.env.example sem valores reais e .env no .gitignore', 'rep'], [30, 'Leitura de fato_pedidos funcionando (linhas coerentes)', 'num']]);
rb('d20-e2', 'file', 'Notebook que consulta, limpa, analisa e gera 3 gráficos, cada um com texto de conclusão em Markdown; executa do início ao fim.', [
  [30, 'Fluxo consulta → limpeza → análise descrito', 'tec'], [30, 'Três gráficos com conclusão escrita', 'vis'], [25, 'Resultados coerentes com o dataset', 'num'], [15, 'Notebook (.ipynb) informado e reproduzível', 'rep']]);

// ───────── Semana 5–6 · Avançado ─────────
rb('d21-e1', 'text', 'Árvore de métricas da receita de e-commerce com 3 níveis: Receita = Pedidos × Ticket Médio; Pedidos = Visitantes × Conversão (ou por canal); Ticket = Itens/pedido × Preço médio. Cada nó é mensurável.', [
  [40, 'Decomposição matematicamente correta em 3 níveis', 'tec'], [30, 'Nós mensuráveis com os dados disponíveis', 'neg'], [30, 'Diagrama legível e consistente', 'vis']]);
rb('d21-e2', 'sql', 'Cinco KPIs da árvore calculados em SQL/DAX com resultados coerentes (ex.: receita 3.682.164,86; 6.534 pedidos; ticket ≈ 563,54; margem 36,6%).', [
  [50, 'Cinco KPIs com valores coerentes com a referência', 'num'], [30, 'Fórmulas SQL/DAX corretas', 'tec'], [20, 'Query/medidas apresentadas', 'rep']], { refs: ['d03-e2', 'd08-e3'] });
rb('d22-e1', 'sql', 'Query RFM do template (recência, frequência, valor; NTILE(5)) e distribuição dos segmentos (ref. 31/12/2025): Leais 144 · Hibernando 142 · Campeões 138 · Em risco 138 · Potencial 138 (800−100 clientes ativos ≈ 700). Regras dos segmentos explicadas.', [
  [40, 'Distribuição dos segmentos coerente com a referência (±5%) ou regra alternativa documentada', 'num'], [25, 'Recência/frequência/valor calculados corretamente (sem cancelados)', 'tec'], [25, 'Regras de cada segmento explicadas', 'neg'], [10, 'Query apresentada', 'rep']], { refs: ['d22-e1'] });
rb('d22-e2', 'text', 'Uma ação por segmento, cada uma com meta mensurável e custo estimado coerente com o tamanho do segmento (ex.: Em risco: cupom de reativação, meta 15% de recompra, custo = clientes × desconto).', [
  [35, 'Uma ação específica por segmento', 'neg'], [30, 'Metas mensuráveis', 'neg'], [25, 'Custo estimado com cálculo plausível', 'num'], [10, 'Clareza do plano', 'vis']]);
rb('d23-e1', 'sql', 'Comparação de 3 modelos (média móvel 3, sazonal ingênuo, Holt-Winters) na mesma janela de teste, com MAPE de cada um e escolha justificada. Série mensal de receita de 24 meses (pico em nov/2025).', [
  [35, 'Três modelos avaliados na mesma janela de teste', 'tec'], [30, 'MAPE calculado corretamente (|erro|/real médio)', 'num'], [25, 'Escolha do melhor modelo justificada', 'neg'], [10, 'Notebook/código informado', 'rep']]);
rb('d23-e2', 'text', 'Previsão de 6 meses com faixa de incerteza (intervalo) e premissas (sazonalidade de fim de ano, tendência de crescimento); 5 linhas de leitura executiva.', [
  [35, 'Seis meses previstos com intervalo', 'num'], [30, 'Premissas explícitas e razoáveis', 'neg'], [25, 'Leitura de ~5 linhas com implicações', 'neg'], [10, 'Gráfico descrito', 'vis']]);
rb('d24-e1', 'text', 'Teste A/B analisado: hipóteses, métrica, tamanho das amostras, taxa de cada grupo, teste estatístico adequado (z de duas proporções/qui-quadrado), p-valor, intervalo de confiança e decisão. Atenção a p-hacking e amostra pequena.', [
  [30, 'Hipótese, métrica e amostras definidas', 'tec'], [35, 'Teste adequado e p-valor/intervalo coerentes com os números', 'num'], [25, 'Decisão coerente com o resultado estatístico', 'neg'], [10, 'Código/notebook informado', 'rep']]);
rb('d24-e2', 'text', 'Recomendação executiva em ~3 linhas: o que fazer, evidência numérica resumida e o risco/limite. Linguagem para diretor, sem jargão.', [
  [40, 'Recomendação clara e acionável', 'neg'], [30, 'Evidência numérica resumida', 'num'], [20, 'Linguagem executiva e curta (~3 linhas)', 'vis'], [10, 'Menciona risco/limitação', 'neg']]);
rb('d25-e1', 'sql', 'DRE mensal (receitas, despesas, resultado) e caixa acumulado em SQL (SUM OVER) e Excel. Totais de referência (24 meses): receitas 3.831.073,82 · despesas 3.200.633,16 · resultado 630.440,66.', [
  [50, 'Totais da DRE conferem com a referência', 'num'], [25, 'Caixa acumulado com window function correta', 'tec'], [15, 'Planilha e SQL consistentes entre si', 'rep'], [10, 'Apresentação clara', 'vis']], { refs: ['d25-e1'] });
rb('d25-e2', 'text', 'Relatório da semana 5 integrando segmentação (RFM), previsão e financeiro com recomendação por área (Comercial, Marketing, Financeiro).', [
  [30, 'Três blocos (RFM, previsão, financeiro) presentes', 'neg'], [30, 'Números coerentes com os dados', 'num'], [30, 'Recomendação por área, acionável', 'neg'], [10, 'Organização', 'vis']]);
rb('d26-e1', 'text', 'Dois prompts próprios para tarefas da rotina, com versões v1→v2 e o que mudou/por quê (contexto, formato de saída, restrições, exemplos). Inclui como validar a resposta da IA.', [
  [40, 'Dois prompts reais com versões v1 e v2', 'tec'], [30, 'Melhorias entre versões justificadas', 'tec'], [20, 'Prompts específicos (contexto, formato, restrições)', 'neg'], [10, 'Critério de validação do resultado', 'rep']]);
rb('d26-e2', 'text', 'Revisão de código com 3 erros plantados: tabela Problema | Correção, com os 3 erros encontrados, causa e correção correta, e como verificar.', [
  [60, 'Os 3 erros identificados corretamente', 'num'], [25, 'Correções corretas e explicadas', 'tec'], [15, 'Forma de verificação', 'rep']], { notes: 'O código com erros plantados vem do tutor e não está no sistema: se o aluno não colar os erros, a confiança é baixa e a entrega vai ao tutor.' });
rb('d27-e1', 'text', 'Script relatorio_semanal.py (gerado com IA, revisado pelo aluno) que lê dados, calcula KPIs e grava um Excel (openpyxl/pandas), com a revisão feita e a evidência da execução.', [
  [35, 'Script funcional descrito/colado (leitura → KPIs → Excel)', 'tec'], [25, 'Revisão do código da IA registrada', 'tec'], [25, 'Excel gerado com valores coerentes', 'num'], [15, 'Reprodutível (dependências, como rodar)', 'rep']]);
rb('d27-e2', 'text', 'Passo a passo de agendamento e monitoramento: agendador (cron/Agendador de Tarefas/GitHub Actions), horário, logs, alerta de falha, credenciais seguras e como reexecutar.', [
  [35, 'Agendamento concreto com ferramenta e frequência', 'tec'], [30, 'Monitoramento e alerta de falha', 'tec'], [20, 'Segredos fora do código', 'rep'], [15, 'Passos claros e ordenados', 'vis']]);
rb('d28-e1', 'file', 'Dashboard v2 com drill-through, bookmark e tooltip de página; o aluno descreve cada recurso, a página de destino/os campos e como usar.', [
  [40, 'Os 3 recursos (drill-through, bookmark, tooltip) descritos e configurados', 'tec'], [25, 'Uso coerente com a análise', 'neg'], [20, 'Design consistente', 'vis'], [15, '.pbix informado', 'rep']]);
rb('d28-e2', 'file', 'Duas funções RLS (ex.: Regional por UF e Diretoria sem filtro) com expressão DAX de filtro e testes "Exibir como" com resultados observados.', [
  [40, 'Duas funções com filtros DAX corretos', 'tec'], [40, 'Testes "Exibir como" com resultado esperado vs observado', 'num'], [20, 'Prints / explicação de uso', 'rep']]);
rb('d29-e1', 'file', 'Apresentação de 5 slides contando a história do projeto final (contexto, problema, análise, insight, recomendação) com títulos-conclusão e um visual por slide.', [
  [30, 'Estrutura narrativa de 5 slides', 'neg'], [30, 'Títulos-conclusão e visual por slide', 'vis'], [25, 'Insights com números do dataset', 'num'], [15, 'Deck informado', 'rep']]);
rb('d29-e2', 'text', 'Ensaio de 5 minutos e lista das 3 perguntas difíceis esperadas, cada uma com resposta preparada baseada em dados.', [
  [35, 'Três perguntas realmente difíceis/relevantes', 'neg'], [40, 'Respostas preparadas e fundamentadas', 'neg'], [25, 'Evidência do ensaio (tempo, aprendizados)', 'rep']]);
rb('d30-e1', 'file', 'Projeto final organizado em pasta/repositório com README (objetivo, como reproduzir), dashboard .pbix, notebook e SQL. Link público/compartilhado e descrição do conteúdo.', [
  [30, 'Dashboard, notebook e SQL presentes e descritos', 'tec'], [30, 'README com objetivo e passo a passo de reprodução', 'rep'], [25, 'Qualidade analítica (pergunta, achados, recomendação)', 'neg'], [15, 'Organização da pasta', 'vis']]);
rb('d30-e2', 'file', 'Apresentação ao tutor em 10 minutos: slides e gravação/ata com perguntas e respostas.', [
  [40, 'Slides ou ata com a estrutura da defesa', 'neg'], [35, 'Perguntas do tutor e respostas registradas', 'neg'], [25, 'Gravação/ata disponível', 'rep']], { notes: 'Esta é uma etapa presencial: preferir revisão do tutor.', forceTutor: true });

// ── validação de consistência ──
for (const [id, r] of Object.entries(R)) {
  const sum = r.checks.reduce((a, c) => a + c[0], 0);
  if (sum !== 100) throw new Error(`rubrica ${id}: pesos somam ${sum}, esperado 100`);
  for (const c of r.checks) if (!DIMS[c[2]]) throw new Error(`rubrica ${id}: dimensão inválida ${c[2]}`);
  for (const k of r.refs ?? []) if (!references[k]) throw new Error(`rubrica ${id}: referência inexistente ${k}`);
}

/** Retorna as rubricas no formato de linhas do banco/JSON. */
export const rubrics = Object.fromEntries(Object.entries(R).map(([id, r]) => [id, {
  exercise_id: id, mode: r.mode, expected: r.expected,
  checks: r.checks.map(([weight, label, dim], i) => ({ id: `c${i + 1}`, label, weight, dim })),
  reference: (r.refs ?? []).map((k) => ({ key: k, description: references[k].desc, sql: references[k].sql, rows: references[k].rows })),
  grading_notes: r.notes ?? null, force_tutor: Boolean(r.forceTutor),
}]));
