# Ambiente de desenvolvimento

Roda o app na sua máquina contra um **branch do Neon** — uma cópia do banco de
produção, isolada e descartável. Você trabalha com os dados reais (cafés,
usuários, histórico) sem risco de mexer no saldo de ninguém.

## 1. Criar o branch no Neon (uma vez)

No painel do Neon, projeto do MT Coffee:

1. Menu **Branches** → **Create branch**
2. Nome: `dev`
3. Parent: `main` (ou o branch onde está a produção), incluindo os dados
4. **Create**

Copie a connection string do branch `dev` — o painel mostra em **Connect**.
Ela é parecida com a de produção, mas com um `ep-...` diferente no host. É essa
diferença que garante o isolamento; confira que não são iguais.

O branch é copy-on-write: nasce em segundos e só ocupa espaço conforme você
altera dados. Quando bagunçar demais, apague e crie outro.

## 2. Configurar o `.env`

O `.env` já existe e está no `.gitignore`. Preencha o `DATABASE_URL` com a URL do
branch `dev`:

```
DATABASE_URL=postgresql://...ep-SEU-BRANCH-DEV....neon.tech/neondb?sslmode=require
JWT_SECRET=(já preenchido)
OPENAI_API_KEY=(opcional)
```

Opcional, mas recomendado — cole aqui o host **de produção** para o app te avisar
caso você aponte para ele sem querer:

```
PROD_DB_HOST=ep-misty-mouse-ajt4x1xu.c-3.us-east-2.aws.neon.tech
```

## 3. Rodar

```bash
npm run dev
```

Isso carrega o `.env` e reinicia sozinho a cada alteração em arquivo `.js`
(`node --watch`). O app sobe em http://localhost:5000.

Na primeira linha do log você vê em qual banco caiu:

```
[db] conectando em ep-xxxx.neon.tech/neondb
```

Confira que é o branch `dev`, não o host de produção. Se for produção e você
tiver configurado o `PROD_DB_HOST`, aparece um aviso em destaque.

## Testando

- **Usuário comum**: entre com a matrícula de alguém que exista no banco
- **Admin**: matrícula `0000` leva ao painel em `/admin.html`

A análise de comprovante por IA só funciona com `OPENAI_API_KEY` no `.env`. Sem
ela, o upload continua funcionando e o comprovante fica pendente de aprovação
manual — que é justamente o fluxo que você quer exercitar na maior parte do tempo.

## Diferenças em relação à produção

| | dev | produção |
|---|---|---|
| `NODE_ENV` | vazio | `production` |
| `JWT_SECRET` | do `.env` | variável na Railway |
| Sem `JWT_SECRET` | avisa e usa segredo fixo | aborta o boot |
| Banco | branch `dev` do Neon | branch de produção |
| Restart | automático (`--watch`) | ao fazer deploy |

## Voltando para a produção

O deploy está descrito em [DEPLOY.md](DEPLOY.md). Nada do que está aqui afeta
produção: o `.env` nunca vai para o Git e a Railway usa as próprias variáveis.
