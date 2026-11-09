A IA escreve rápido, mas erra com confiança. Seu papel é dirigir: dizer o que quer, conferir e registrar. Siga os 5 passos.

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
- Não use um código que você não consegue explicar em uma frase.
