# Conectar uma ferramenta ao banco do programa

> Para **escrever SQL** use o **Editor SQL do app** (menu lateral): funciona no navegador, sem instalar nada.
> Este guia é para quando outra ferramenta precisa ler o banco: **Power BI** (dia 9), **Python** (dia 20) ou um cliente SQL como o **DBeaver**.
> Você **não** precisa de conta nem de e-mail no Supabase: o login do painel do Supabase é só do tutor.

## O que o tutor vai te passar
| Campo | Valor |
|---|---|
| Host | (informado pelo tutor, ex.: aws-0-<região>.pooler.supabase.com) |
| Porta | 5432 |
| Banco | postgres |
| Usuário | aluno_leitura.<código-do-projeto> (informado pelo tutor) |
| Senha | (informada pelo tutor; não compartilhe nem salve em arquivos do projeto) |
| Schema | treinamento |
| SSL | obrigatório |

## Power BI Desktop
1. **Obter dados > Banco de dados PostgreSQL**.
2. Servidor: `host:5432`; Banco de dados: `postgres`; modo **Importar**.
3. Na janela de credenciais, aba **Banco de dados**: usuário e senha acima.
4. No navegador, marque as tabelas do schema `treinamento` e carregue.
5. Se aparecer erro de certificado/SSL, avise o tutor (veja a observação no guia de setup).

## Python
Use variáveis de ambiente (SUPABASE_DB_HOST, SUPABASE_DB_USER, SUPABASE_DB_PASSWORD, SUPABASE_DB_NAME, SUPABASE_DB_PORT) e nunca escreva a senha no código. Use o template "Prompt: conectar Python ao Supabase".

## DBeaver Community (opcional)
1. Instale em dbeaver.io/download.
2. **Banco de dados > Nova conexão > PostgreSQL**; preencha Host, Porta, Banco, Usuário e Senha.
3. Na aba **SSL**, ative SSL e use o modo **require**.
4. **Testar conexão** (o DBeaver baixa o driver na primeira vez) e **Concluir**.
5. Botão direito na conexão > **Editor SQL > Novo script** e rode:

```sql
SELECT COUNT(*) FROM treinamento.fato_pedidos;
```

## Se der erro
- **Senha/usuário inválidos**: confira o usuário completo (com o ponto e o código do projeto) e peça a senha de novo ao tutor.
- **Timeout/host não encontrado**: use o host do Session pooler informado pelo tutor (não o host "db.").
- Você só consegue **ler** (SELECT) as tabelas do schema treinamento; comandos que alteram dados são bloqueados de propósito.

## Sem acesso ao banco?
Use o dataset em Excel (recurso "Dataset de treinamento") para o Power BI e o Python, e avise o tutor.
