# MT Coffee

Sistema de controle de consumo de café para um escritório/laboratório
compartilhado. Cada pessoa registra sua dose pela matrícula, o custo é rateado a
partir do preço real do café comprado, e o saldo é recarregado via PIX com
comprovante.

## Stack

- Node.js 20+ e Express 5
- PostgreSQL (Neon)
- Frontend estático em `public/`, servido pelo mesmo Express
- Deploy na Railway via Docker

## Estrutura

```
server.js        API + entrega dos arquivos estáticos
database.js      Pool de conexão e criação idempotente do schema
cost-engine.js   Rateio de custo, recálculo de preço por dose e transações
ai.js            Leitura de comprovantes e notas fiscais por visão (opcional)
scripts/
  check-db.js    Diagnóstico: qual banco, quantas linhas
public/
  index.html     Página principal
  admin.html     Painel administrativo
```

## Funcionalidades

- Cadastro de usuários por matrícula
- Registro de consumo com dedução de saldo e de estoque
- Preço por dose calculado dinamicamente a partir do custo real do estoque
- Recarga de saldo com envio de comprovante PIX
- Leitura automática do valor do comprovante por IA, com aprovação automática
  quando a confiança é alta e fila manual quando não é
- Extração de itens de nota fiscal de compra de café
- Avaliação dos cafés pelos usuários
- Painel de administração (matrícula `0000`)

Valores em BRL. Dose padrão de 10g.

## Rodando

Desenvolvimento local: veja [DEV.md](DEV.md).
Deploy em produção: veja [DEPLOY.md](DEPLOY.md).

Resumo:

```bash
npm install
```

```bash
npm run dev
```

## Variáveis de ambiente

| Variável | Obrigatória | Descrição |
|---|---|---|
| `DATABASE_URL` | sim | Connection string do PostgreSQL |
| `JWT_SECRET` | em produção | Assina os tokens de admin; sem ela o boot aborta |
| `PROD_DB_HOST` | não | Host de produção; ativa aviso ao rodar dev apontado para ele |
| `OPENAI_API_KEY` | não | Liga a análise de comprovantes e notas |
| `OPENAI_VISION_MODEL` | não | Padrão `gpt-5.4` |
| `PORT` | não | Padrão 5000; a Railway injeta automaticamente |
