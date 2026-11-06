# 📖 Dicionário de dados do programa DAFA

Guia das 8 tabelas usadas em todos os exercícios (schema "treinamento" no Supabase e abas do Excel). Os dados são 100% fictícios e cobrem 01/2024 a 12/2025.

> Versão em Excel: [dicionario-dados.xlsx](../web/public/templates/dicionario-dados.xlsx) (e aba `DICIONARIO` no dataset). Fonte única: `content/dicionario.json`.

## Resumo das tabelas

| Tabela | Tipo | Linhas | Uma linha representa |
|---|---|---:|---|
| `dim_clientes` | Cadastro (dimensão) | 800 | um cliente |
| `dim_produtos` | Cadastro (dimensão) | 60 | um produto |
| `fato_pedidos` | Transação (fato) | 6.900 | um pedido |
| `fato_itens_pedido` | Transação (fato) | 14.994 | um produto dentro de um pedido |
| `fato_entregas` | Transação (fato) | 6.514 | a entrega de um pedido |
| `fato_campanhas` | Resumo mensal (fato) | 120 | um canal de mídia em um mês |
| `fato_financeiro` | Lançamento (fato) | 192 | um lançamento mensal por categoria |
| `esporte_partidas` | Evento (fato) | 760 | um jogo |

## Como as tabelas se ligam

| Tabela A | Tabela B | Coluna | Cardinalidade | Observação |
|---|---|---|---|---|
| dim_clientes | fato_pedidos | cliente_id | 1 para vários | Um cliente pode ter vários pedidos. 100 clientes nunca compraram. |
| fato_pedidos | fato_itens_pedido | pedido_id | 1 para vários | Cada pedido tem de 1 a 4 itens. |
| dim_produtos | fato_itens_pedido | produto_id | 1 para vários | Um produto aparece em muitos itens. |
| fato_pedidos | fato_entregas | pedido_id | 1 para 0 ou 1 | 386 pedidos não têm entrega: 366 cancelados e 20 pendentes. |
| fato_campanhas, fato_financeiro, esporte_partidas | — | — | sem ligação | Tabelas independentes: não há chave para juntá-las às demais. |

## Colunas de cada tabela

### `dim_clientes`

**Uma linha = um cliente.** Quem compra: segmento, origem e localização. Liga com os pedidos por cliente_id.

| Coluna | Tipo | O que significa | Valores possíveis / exemplo | Atenção |
|---|---|---|---|---|
| `cliente_id` | Número inteiro | Código único do cliente (chave primária). | — | É o que liga o cliente aos pedidos. |
| `nome` | Texto | Nome do cliente. | Ex.: Cliente 0701 | Nomes fictícios. |
| `cidade` | Texto | Cidade de cadastro do cliente. | Ex.: Porto Alegre |  |
| `uf` | Texto (2 letras) | Estado do cliente. | BA, CE, DF, MG, PE, PR, RJ, RS, SP | Não é a mesma coisa que uf_entrega do pedido: use cada uma para a pergunta certa. |
| `segmento` | Texto | Perfil do cliente. | basico, premium, corporativo |  |
| `canal_aquisicao` | Texto | Como o cliente chegou até a empresa. | E-mail, Google Ads, Indicação, Influenciadores, Meta Ads, Orgânico | Não confundir com o canal de venda do pedido (fato_pedidos.canal). |
| `data_cadastro` | Data | Dia em que o cliente se cadastrou. | 07/12/2023 a 28/12/2025 |  |

### `dim_produtos`

**Uma linha = um produto.** O que se vende: categoria, preço de tabela e custo. Liga com os itens por produto_id.

| Coluna | Tipo | O que significa | Valores possíveis / exemplo | Atenção |
|---|---|---|---|---|
| `produto_id` | Número inteiro | Código único do produto (chave primária). | — |  |
| `nome` | Texto | Nome do produto. | Ex.: Eletrônicos 01 |  |
| `categoria` | Texto | Grupo do produto. | Beleza, Casa, Eletrônicos, Esporte, Livros, Moda |  |
| `preco` | Valor em R$ | Preço de tabela, sem desconto. | R$ 20,25 a R$ 572,84 | O que o cliente pagou está em fato_itens_pedido.preco_unitario. |
| `custo` | Valor em R$ | Custo de cada unidade para a empresa. | R$ 10,53 a R$ 371,69 | Usado para calcular margem. |

### `fato_pedidos`

**Uma linha = um pedido.** A venda em si: quando, quem, por qual canal, para onde e qual a situação. Tabela central do modelo.

| Coluna | Tipo | O que significa | Valores possíveis / exemplo | Atenção |
|---|---|---|---|---|
| `pedido_id` | Número inteiro | Número único do pedido (chave primária). | — | Liga com itens e entregas. |
| `cliente_id` | Número inteiro | Quem fez o pedido. | Código de dim_clientes | Chave estrangeira. |
| `data_pedido` | Data | Dia em que o pedido foi feito. | 01/01/2024 a 30/12/2025 |  |
| `status` | Texto | Situação do pedido. | entregue (6.452), enviado (62), pendente (20), cancelado (366) | Cancelados e pendentes não representam venda concluída. Decida se entram ou não na receita. |
| `canal` | Texto | Onde a venda foi feita. | site, app, marketplace, loja | Canal de venda, diferente de canal_aquisicao do cliente. |
| `uf_entrega` | Texto (2 letras) | Estado de destino da entrega. | Mesmas 9 UFs dos clientes |  |
| `frete` | Valor em R$ | Frete cobrado no pedido inteiro. | R$ 0,00 a R$ 50,00 | É um valor por pedido, não por item: somar o frete depois de juntar com os itens repete o valor e infla o total. |
| `desconto_pct` | Percentual | Desconto concedido no pedido, em pontos percentuais. | 0 a 20 (20 significa 20%) | O desconto já está refletido no preco_unitario dos itens. |

### `fato_itens_pedido`

**Uma linha = um produto dentro de um pedido.** O detalhe da venda: o que e quanto foi comprado. Base para receita, margem e ranking de produtos.

| Coluna | Tipo | O que significa | Valores possíveis / exemplo | Atenção |
|---|---|---|---|---|
| `item_id` | Número inteiro | Código único do item (chave primária). | — |  |
| `pedido_id` | Número inteiro | Pedido ao qual o item pertence. | Código de fato_pedidos | Chave estrangeira. Cada pedido tem de 1 a 4 itens. |
| `produto_id` | Número inteiro | Produto vendido. | Código de dim_produtos | Chave estrangeira. |
| `quantidade` | Número inteiro | Unidades vendidas do produto. | 1 a 3 |  |
| `preco_unitario` | Valor em R$ | Preço pago por unidade, já com o desconto aplicado. | — | Receita do item = quantidade × preco_unitario. Não aplique o desconto de novo. |

### `fato_entregas`

**Uma linha = a entrega de um pedido.** Logística: quem transportou, quanto demorou e se atrasou.

| Coluna | Tipo | O que significa | Valores possíveis / exemplo | Atenção |
|---|---|---|---|---|
| `pedido_id` | Número inteiro | Pedido entregue (chave primária e estrangeira). | Código de fato_pedidos | Existe no máximo uma entrega por pedido. |
| `transportadora` | Texto | Empresa que fez o transporte. | CargaMais, EntregaJá, RápidoLog, TransBrasil |  |
| `data_envio` | Data | Dia em que o pedido saiu para entrega. | — |  |
| `prazo_dias` | Número inteiro | Prazo prometido ao cliente, em dias. | 3 a 8 |  |
| `data_entrega` | Data | Dia em que chegou ao cliente. | — | Vazia em 62 entregas, que são pedidos ainda em trânsito (status enviado). Não conte como atraso. |

### `fato_campanhas`

**Uma linha = um canal de mídia em um mês.** Marketing: quanto se investiu e o que isso gerou. Não tem chave com as outras tabelas.

| Coluna | Tipo | O que significa | Valores possíveis / exemplo | Atenção |
|---|---|---|---|---|
| `campanha_id` | Número inteiro | Código único da linha (chave primária). | — |  |
| `canal` | Texto | Canal de mídia. | Afiliados, E-mail, Google Ads, Influenciadores, Meta Ads | Lista diferente de canal_aquisicao e de fato_pedidos.canal: não cruze pelo nome. |
| `mes` | Data | Mês da campanha (sempre o dia 1). | 01/2024 a 12/2025 |  |
| `investimento` | Valor em R$ | Quanto foi gasto no mês. | R$ 184,01 a R$ 3.589,71 |  |
| `impressoes` | Número inteiro | Quantas vezes o anúncio foi exibido. | — |  |
| `cliques` | Número inteiro | Quantos cliques recebeu. | 172 a 5.351 |  |
| `conversoes` | Número inteiro | Quantas ações desejadas (compras) geraram. | 2 a 208 |  |

### `fato_financeiro`

**Uma linha = um lançamento mensal por categoria.** Financeiro: receitas e despesas por centro de custo, para DRE e fluxo de caixa. Não tem chave com as outras tabelas.

| Coluna | Tipo | O que significa | Valores possíveis / exemplo | Atenção |
|---|---|---|---|---|
| `lancamento_id` | Número inteiro | Código único do lançamento (chave primária). | — |  |
| `data` | Data | Último dia do mês do lançamento. | 31/01/2024 a 31/12/2025 | São 24 datas, uma por mês. |
| `tipo` | Texto | Natureza do lançamento. | receita, despesa |  |
| `categoria` | Texto | Tipo de receita ou despesa. | Receita: Serviços e assinaturas, Vendas de produtos. Despesa: Aluguel e utilidades, Custo de mercadorias, Logística e fretes, Marketing e mídia, Pessoal, Tecnologia |  |
| `centro_custo` | Texto | Área responsável. | Administrativo, Comercial, Logística, Marketing, TI |  |
| `valor` | Valor em R$ | Valor do lançamento. | R$ 2.044,30 a R$ 287.803,02 | Sempre positivo, inclusive nas despesas. Resultado = receitas − despesas. |

### `esporte_partidas`

**Uma linha = um jogo.** Cenário de esporte: público, bilheteria e resultado de um campeonato. Não tem chave com as outras tabelas.

| Coluna | Tipo | O que significa | Valores possíveis / exemplo | Atenção |
|---|---|---|---|---|
| `partida_id` | Número inteiro | Código único do jogo (chave primária). | — |  |
| `temporada` | Número inteiro | Ano do campeonato. | 2024, 2025 |  |
| `rodada` | Número inteiro | Rodada do campeonato. | 1 a 38 |  |
| `data_jogo` | Data | Dia do jogo. | — |  |
| `mandante` | Texto | Time que joga em casa. | 20 times, ex.: Águias do Norte, Leões da Serra |  |
| `visitante` | Texto | Time visitante. | Os mesmos 20 times |  |
| `gols_mandante` | Número inteiro | Gols do time de casa. | 0 a 4 | Vitória = mais gols; empate = igual. Para classificação, vitória vale 3 pontos e empate 1. |
| `gols_visitante` | Número inteiro | Gols do visitante. | 0 a 3 |  |
| `publico` | Número inteiro | Pessoas presentes no jogo. | 10.204 a 55.944 |  |
| `receita_bilheteria` | Valor em R$ | Arrecadação com ingressos no jogo. | R$ 468.882,64 a R$ 4.284.674,48 |  |

## Cuidados e regras de cálculo

- **Receita:** Receita de um item = quantidade × preco_unitario. O preço já vem com o desconto, então não aplique desconto_pct de novo.
- **Margem:** Margem = receita − quantidade × custo (o custo está em dim_produtos). Margem % = margem ÷ receita.
- **Pedidos cancelados:** Há 366 pedidos cancelados e 20 pendentes. Defina e registre se entram ou não no cálculo; para receita, normalmente excluem-se os cancelados.
- **Frete repetido:** O frete é por pedido. Ao juntar pedidos com itens, o frete se repete em cada item: some o frete antes de juntar, ou use uma linha por pedido.
- **Conferir ao juntar tabelas:** Conte as linhas antes e depois de juntar tabelas. Se o número crescer sem motivo, houve duplicação.
- **Atraso na entrega:** Atraso = data_entrega − data_envio maior que prazo_dias. Entregas sem data_entrega (62) ainda estão em trânsito e ficam fora do cálculo.
- **Três 'canais' diferentes:** canal_aquisicao (como o cliente chegou), fato_pedidos.canal (onde comprou) e fato_campanhas.canal (onde se anunciou) têm listas e significados diferentes.
- **Métricas de campanha:** CTR = cliques ÷ impressões. CPC = investimento ÷ cliques. CPA = investimento ÷ conversões. O retorno sobre o investimento (ROAS) não é calculado nos exercícios porque fato_campanhas não registra a receita gerada por cada campanha.
- **Resultado financeiro:** Em fato_financeiro todos os valores são positivos. Resultado = soma das receitas − soma das despesas.
- **Período dos dados:** Pedidos, campanhas, financeiro e jogos vão de 01/2024 a 12/2025. Os dados são fictícios, para treino.
