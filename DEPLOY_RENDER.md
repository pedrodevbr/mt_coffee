# Deploy MT Coffee no Render

## Pre-requisitos
- Conta no [Render](https://render.com) (login com GitHub)
- Repositorio `pedrodevbr/mt_coffee` no GitHub

---

## Deploy automatico (Blueprint)

O jeito mais facil — o `render.yaml` ja configura tudo automaticamente:

1. Acesse [dashboard.render.com/select-repo?type=blueprint](https://dashboard.render.com/select-repo?type=blueprint)
2. Conecte o repo **pedrodevbr/mt_coffee**
3. Selecione a branch **`claude/migrate-from-replit-TwtXV`** (ou `main` se ja fez merge)
4. O Render vai ler o `render.yaml` e criar automaticamente:
   - Web Service (Node.js)
   - PostgreSQL database
   - Disco persistente para comprovantes
   - Variaveis de ambiente
5. Clique **"Apply"** e aguarde o deploy

Pronto! O Render gera uma URL tipo `mt-coffee.onrender.com`.

---

## Deploy manual (passo a passo)

Se preferir configurar manualmente:

### 1. Criar banco de dados PostgreSQL
1. No dashboard, clique **"New"** → **"PostgreSQL"**
2. Nome: `mt-coffee-db`
3. Plano: **Starter** ($7/mes) ou **Free** (expira em 90 dias)
4. Clique **"Create Database"**
5. Quando estiver pronto, copie a **Internal Database URL**

### 2. Criar o Web Service
1. Clique **"New"** → **"Web Service"**
2. Conecte o repo **pedrodevbr/mt_coffee**
3. Configure:
   - Nome: `mt-coffee`
   - Runtime: **Node**
   - Branch: `claude/migrate-from-replit-TwtXV`
   - Build command: `npm ci --omit=dev`
   - Start command: `node server.js`
   - Plano: **Starter** ($7/mes)

### 3. Configurar variaveis de ambiente
No servico web, va em **"Environment"** → **"Add Environment Variable"**:
- `DATABASE_URL` = cole a Internal Database URL do passo 1
- `JWT_SECRET` = `d335aa0c8fb5071f443ad75b7fe7b450522eaba0d18cf7cd1fcc0adbc02c52bf`
- `NODE_ENV` = `production`

### 4. Adicionar disco para comprovantes
No servico web, va em **"Disks"** → **"Add Disk"**:
- Nome: `receipt-uploads`
- Mount path: `/app/uploads/receipts`
- Tamanho: 1 GB

### 5. Deploy
Clique **"Manual Deploy"** → **"Deploy latest commit"**

---

## Migrar dados do Replit (opcional)

### No Replit:
```bash
pg_dump $DATABASE_URL > backup.sql
```
Baixe o arquivo `backup.sql` para seu computador.

### No seu computador:
```bash
# Pegue a External Database URL no dashboard do Render (PostgreSQL → Info)
psql "SUA_DATABASE_URL_DO_RENDER" < backup.sql
```

---

## Troubleshooting

### Erro `ECONNREFUSED 127.0.0.1:5432`
A variavel `DATABASE_URL` nao esta configurada. Va em "Environment" e adicione.

### App demora para responder (plano Free)
O plano Free desliga o servico apos 15 min sem uso. A primeira requisicao demora ~30s para religar. Use o plano Starter ($7/mes) para evitar isso.

### Erro de SSL
O codigo suporta SSL automaticamente para bancos remotos.

---

## Custo estimado
- Web Service (Starter): $7/mes
- PostgreSQL (Starter): $7/mes
- **Total: ~$7/mes** (vs $20/mes no Replit)

Ou use o plano Free para o web service (com cold starts) e pague apenas o banco: **~$7/mes total**.
