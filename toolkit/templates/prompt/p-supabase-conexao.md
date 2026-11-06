Escreva um script Python que se conecta ao Postgres do Supabase usando SQLAlchemy + psycopg, lendo as credenciais
de variáveis de ambiente (SUPABASE_DB_HOST, SUPABASE_DB_USER, SUPABASE_DB_PASSWORD, SUPABASE_DB_NAME, SUPABASE_DB_PORT).
Deve: (1) abrir a conexão com sslmode=require; (2) executar uma consulta SQL que eu passo como string e devolver um DataFrame;
(3) tratar erros de conexão com mensagem clara em português; (4) NUNCA imprimir a senha; (5) incluir exemplo lendo
treinamento.fato_pedidos (limite 1000). Explique como criar o arquivo .env e como NÃO versioná-lo no git.
