# Deploy MT Coffee no Railway

## Pre-requisitos
- Conta no [Railway](https://railway.com) (login com GitHub)
- Repositorio `pedrodevbr/mt_coffee` no GitHub

---

## Passo a passo

### 1. Criar projeto no Railway
1. Acesse [railway.com/new](https://railway.com/new)
2. Clique **"Deploy from GitHub Repo"**
3. Selecione o repo **pedrodevbr/mt_coffee**
4. Selecione a branch **`claude/migrate-from-replit-TwtXV`** (ou `main` se ja fez merge)
5. Aguarde o build finalizar

### 2. Adicionar banco de dados PostgreSQL
1. No dashboard do projeto, clique **"+ New"** → **"Database"** → **"PostgreSQL"**
2. Aguarde o banco ser provisionado (leva alguns segundos)

### 3. Configurar variaveis de ambiente no servico do app
1. Clique no **servico do app** (o que mostra o icone do GitHub, NAO o PostgreSQL)
2. Va na aba **"Variables"**
3. Clique **"Add Reference Variable"** → selecione o PostgreSQL → escolha `DATABASE_URL`
   - Se nao aparecer a opcao de referencia, copie manualmente:
     - Clique no **servico PostgreSQL** → aba **"Variables"** ou **"Connect"**
     - Copie o valor de `DATABASE_URL`
     - Volte ao **servico do app** → **"Variables"** → **"New Variable"**
     - Nome: `DATABASE_URL`, Valor: cole a URL copiada
4. Adicione mais uma variavel:
   - Nome: `JWT_SECRET`
   - Valor: `d335aa0c8fb5071f443ad75b7fe7b450522eaba0d18cf7cd1fcc0adbc02c52bf`

### 4. Adicionar volume para comprovantes
1. Clique no **servico do app** → aba **"Settings"**
2. Scroll ate **"Volumes"** → **"Add Volume"**
3. Mount path: `/app/uploads/receipts`
4. Salve

### 5. Gerar dominio publico
1. Clique no **servico do app** → aba **"Settings"**
2. Scroll ate **"Networking"** → **"Generate Domain"**
3. Voce vai receber uma URL tipo `mt-coffee-production.up.railway.app`
4. Use essa URL para acessar o app

### 6. Verificar deploy
1. Clique no **servico do app** → aba **"Deployments"**
2. O deploy mais recente deve mostrar status **"Success"**
3. Nos logs, deve aparecer: `Server running on http://localhost:XXXX` e `Database schema initialized successfully`
4. Acesse a URL gerada no passo 5 — a tela de login do MT Coffee deve aparecer

---

## Migrar dados do Replit (opcional)

Se voce tem dados no Replit que quer manter:

### No Replit:
```bash
pg_dump $DATABASE_URL > backup.sql
```
Baixe o arquivo `backup.sql` para seu computador.

### No seu computador:
```bash
# Pegue a DATABASE_URL do Railway (dashboard → PostgreSQL → Variables)
psql "SUA_DATABASE_URL_DO_RAILWAY" < backup.sql
```

---

## Troubleshooting

### Erro `ECONNREFUSED 127.0.0.1:5432`
A variavel `DATABASE_URL` nao esta configurada no servico do app. Siga o passo 3 novamente.

### Erro de SSL
O codigo ja suporta SSL automaticamente. Se o banco exigir SSL (como Neon), a conexao sera feita com `{ rejectUnauthorized: false }`.

### App nao inicia
Verifique nos logs (aba "Deployments" → clique no deploy → "View Logs") se ha erros. As causas mais comuns:
- Falta variavel `DATABASE_URL`
- Falta variavel `JWT_SECRET`
- Erro de build (verifique se `package-lock.json` esta no repo)

---

## Custo estimado
- Servico Node.js: ~$1-2/mes
- PostgreSQL: ~$2-3/mes
- **Total: ~$5/mes** (vs $20/mes no Replit)
