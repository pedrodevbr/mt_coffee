# Deploy do MT Coffee na Railway

Custo esperado: plano Hobby US$5/mês, que já inclui US$5 de uso. App + Postgres
pequenos costumam caber dentro disso.

A ordem importa: **restaure o banco antes de subir o app**. O `initSchema()` do
`database.js` é idempotente, mas o dump tem `CREATE TABLE` sem `IF NOT EXISTS` e
falha se as tabelas já existirem.

---

## 0. Instalar o psql (uma vez)

O dump usa `COPY` e o meta-comando `\restrict`, que só o `psql` entende.

```bash
winget install -e --id PostgreSQL.PostgreSQL.16
```

Depois feche e reabra o terminal e confirme com `psql --version`. Se não achar o
comando, adicione `C:\Program Files\PostgreSQL\16\bin` ao PATH.

## 1. Login e projeto

```bash
railway login
```

```bash
railway init --name mt-coffee
```

## 2. Criar o Postgres

```bash
railway add --database postgres
```

## 3. Restaurar o backup

Pegue a URL pública do banco (a interna `.railway.internal` só funciona dentro da
rede da Railway):

```bash
railway variables --service Postgres --kv
```

Copie o valor de `DATABASE_PUBLIC_URL` e restaure:

```bash
psql "COLE_A_DATABASE_PUBLIC_URL_AQUI" -f exports/database_backup.sql
```

Espere alguns minutos — são 33MB, quase tudo comprovante em `bytea`.

## 4. Variáveis do app

O `${{Postgres.DATABASE_URL}}` é uma referência da Railway: ela resolve sozinha
para a URL interna, sem você colar credencial em lugar nenhum.

```bash
railway variables --set 'DATABASE_URL=${{Postgres.DATABASE_URL}}' --set 'JWT_SECRET=0e37faf187bc604b01f217c91d57dbc4a26dfae84a29d24f29f6dee3b832dfbe' --set 'NODE_ENV=production'
```

A chave da OpenAI (opcional — sem ela o upload de comprovante continua
funcionando, só entra como pendente de aprovação manual):

```bash
railway variables --set 'OPENAI_API_KEY=sk-SUA_CHAVE_AQUI'
```

## 5. Subir

```bash
railway up
```

## 6. Gerar o domínio público

```bash
railway domain
```

Isso imprime a URL final. Teste entrando com a matrícula `0000` para cair no
painel de admin.

---

## Verificação pós-deploy

```bash
railway logs
```

Você deve ver `Server running on http://localhost:...` e **não** deve ver o aviso
`[auth] JWT_SECRET não definido`. Se aparecer, o passo 4 não pegou.

## Rollback

A Railway guarda os deploys anteriores. No painel, aba **Deployments**, use
"Redeploy" em qualquer build antiga.
