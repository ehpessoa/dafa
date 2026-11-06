# Conectar ao banco do programa

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

```sql
SELECT COUNT(*) FROM treinamento.fato_pedidos;
```

## Se der erro
- **Senha/usuário inválidos**: confira o usuário completo (com o ponto e o código do projeto) e peça a senha de novo ao tutor.
- **Timeout/host não encontrado**: use o host do Session pooler informado pelo tutor (não o host "db.").
- **Erro de certificado/SSL**: confirme o modo require e peça orientação ao tutor.
- Você só consegue **ler** (SELECT) as tabelas do schema treinamento; comandos que alteram dados são bloqueados de propósito.

## Sem acesso ao banco?
Use o dataset em Excel (recurso "Dataset de treinamento") e faça os mesmos exercícios com tabelas dinâmicas e fórmulas; avise o tutor.
