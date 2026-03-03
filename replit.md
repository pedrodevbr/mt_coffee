# MT Coffee App

A coffee consumption tracking system for a shared office/lab setting.

## Architecture

- **Runtime**: Node.js 20
- **Framework**: Express.js 5
- **Database**: PostgreSQL (Replit built-in, accessed via `DATABASE_URL`)
- **Frontend**: Static HTML/CSS/JS served from the `public/` directory
- **Single server**: Backend API and frontend served together on the same Express app

## Project Structure

```
server.js        - Express server (API routes + static file serving)
database.js      - PostgreSQL connection pool and schema initialization
public/
  index.html     - Main user-facing page
  admin.html     - Admin panel
  css/style.css  - Styles
  js/main.js     - Frontend logic
  js/admin.js    - Admin frontend logic
```

## Running

- **Port**: 5000 (default, configurable via PORT env var)
- **Start**: `node server.js`
- **Database**: PostgreSQL via DATABASE_URL env var (persistent across deployments)

## Features

- User management (create/read/update/delete users with a "matricula" ID)
- Coffee stock management (track grams and cost)
- Coffee consumption tracking (deduct from user balance and stock)
- Balance recharge for users
- QR code upload for payment
- PIX key management for admin
- Admin panel for system management (matricula "0000")

## Key Details

- Admin access: Enter matricula "0000" on the main page to be redirected to `/admin.html`
- Admin user is auto-created in the database on startup
- All monetary values are in BRL (R$)
- Dose size default: 10g, price calculated dynamically from stock cost

## Deployment

- Target: autoscale
- Run command: `node server.js`
- Database: Replit PostgreSQL (persists across deployments)
