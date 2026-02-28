# MT Coffee App

A coffee consumption tracking system for a shared office/lab setting.

## Architecture

- **Runtime**: Node.js 20
- **Framework**: Express.js 5
- **Database**: SQLite (via sqlite3)
- **Frontend**: Static HTML/CSS/JS served from the `public/` directory
- **Single server**: Backend API and frontend served together on the same Express app

## Project Structure

```
server.js        - Express server (API routes + static file serving)
database.js      - SQLite connection and schema initialization
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
- **Database file**: `mt_coffee.sqlite` (created automatically)

## Features

- User management (create/read/update/delete users with a "matricula" ID)
- Coffee stock management (track grams and cost)
- Coffee consumption tracking (deduct from user balance and stock)
- Balance recharge for users
- QR code upload for payment
- Admin panel for system management

## Deployment

- Target: autoscale
- Run command: `node server.js`
- Note: Uses SQLite, so persistent storage requires a VM deployment or external DB for production
