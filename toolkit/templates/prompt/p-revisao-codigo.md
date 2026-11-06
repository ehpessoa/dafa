Revise o código abaixo como um analista sênior cético. Responda em tabela (Problema | Linha | Risco | Correção):
- erros de lógica (joins que duplicam linhas, filtros de data, divisão por zero);
- premissas ocultas (moeda, fuso, cancelados incluídos?);
- segurança (credenciais, SQL injection);
- reprodutibilidade (sementes aleatórias, caminhos fixos).
Depois escreva 3 testes rápidos (asserts) que provem que os totais batem com a fonte.
CÓDIGO: [COLE AQUI]
