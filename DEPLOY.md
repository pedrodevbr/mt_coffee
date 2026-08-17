# Deploy do MT Coffee — App e Banco no Railway com Google Gemini

O MT Coffee roda inteiramente dentro da Railway (serviço Node.js + serviço PostgreSQL nativo).

---

## 1. Variáveis de Ambiente no Railway

No painel da Railway (ou via CLI), configure as variáveis do serviço `mt-coffee`:

```bash
railway variables --set "DATABASE_URL=postgresql://postgres:fScgNujACJHoCBNDHYprakvxMlzEbwFP@postgres.railway.internal:5432/railway"
railway variables --set "JWT_SECRET=0e37faf187bc604b01f217c91d57dbc4a26dfae84a29d24f29f6dee3b832dfbe"
railway variables --set "NODE_ENV=production"
```

### Leitura com IA (Google Gemini)
Para ativar a extração automática de dados dos comprovantes PIX e notas fiscais:

```bash
railway variables --set "GEMINI_API_KEY=AIzaSy..."
```
*(Opcional: você pode especificar `GEMINI_MODEL=gemini-2.5-flash`)*

---

## 2. Deploy

Para enviar a versão atualizada:

```bash
railway up
```

---

## 3. Domínio e Acesso

A URL pública da aplicação é:
- `https://mt-coffee-production.up.railway.app`

Para acessar a área de administração:
- Matrícula: `0000` (PIN padrão: `1234`)
