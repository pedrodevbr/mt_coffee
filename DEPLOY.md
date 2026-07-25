# Deploy do MT Coffee — app na Railway, banco no Neon

Custo esperado: US$5/mês do plano Hobby da Railway (que já inclui US$5 de uso).
O banco fica no free tier do Neon: 0,5GB, e o dump tem 33MB.

A ordem importa: **restaure o banco antes de subir o app**. O `initSchema()` do
`database.js` é idempotente, mas o dump tem `CREATE TABLE` sem `IF NOT EXISTS` e
falha se as tabelas já existirem.

---

## 1. Restaurar o backup no Neon

Precisa do `psql` (o dump usa `COPY` e o meta-comando `\restrict`). Se não tiver:

```bash
winget install -e --id PostgreSQL.PostgreSQL.16
```

Conecte usando a connection string do painel do Neon:

```bash
psql "postgresql://USUARIO:SENHA@HOST.neon.tech/neondb?sslmode=require"
```

E, já dentro do prompt `neondb=>`, importe:

```bash
\i exports/database_backup.sql
```

Confira com `\dt` que apareceram `users`, `transactions`, `payment_receipts` e
`coffees`. Depois `\q`.

O aviso do Windows sobre code page 437 é cosmético: o próprio dump executa
`SET client_encoding = 'UTF8'` antes de inserir dados, então os acentos entram
corretos.

## 2. Login e projeto na Railway

```bash
railway login
```

```bash
railway init --name mt-coffee
```

## 3. Variáveis do app

Use a **mesma** connection string do Neon do passo 1. Não há serviço Postgres
dentro da Railway, então não existe referência `${{Postgres.DATABASE_URL}}`.

```bash
railway variables --set 'DATABASE_URL=postgresql://USUARIO:SENHA@HOST.neon.tech/neondb?sslmode=require' --set 'JWT_SECRET=0e37faf187bc604b01f217c91d57dbc4a26dfae84a29d24f29f6dee3b832dfbe' --set 'NODE_ENV=production'
```

O `database.js` liga SSL sozinho para qualquer host que não seja local, então a
URL do Neon funciona sem ajuste.

A chave da OpenAI é opcional — sem ela o upload de comprovante continua
funcionando, só entra como pendente de aprovação manual:

```bash
railway variables --set 'OPENAI_API_KEY=sk-SUA_CHAVE_AQUI'
```

## 4. Subir

```bash
railway up
```

## 5. Gerar o domínio público

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
`[auth] JWT_SECRET não definido`. Se aparecer, o passo 3 não pegou.

## Observação sobre o Neon

O free tier suspende o banco após alguns minutos sem uso. A primeira requisição
depois disso paga um cold start de poucos segundos; as seguintes ficam normais.
Se isso incomodar no uso diário, o Postgres da própria Railway não suspende.

## Rollback

A Railway guarda os deploys anteriores. No painel, aba **Deployments**, use
"Redeploy" em qualquer build antiga.
