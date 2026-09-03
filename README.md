# Abron Shop Backend

Standalone NestJS/Fastify REST API for Abron Shop. The React frontend is maintained and deployed from a separate repository.

## Stack

- NestJS 11 and Fastify
- PostgreSQL and Prisma
- JWT access tokens and rotating refresh sessions
- Sharp image optimization with persistent local media storage

## Local development

Requirements: Node.js 22+, npm, and PostgreSQL 15+.

```bash
cp .env.example .env
# Set the database URL, JWT secrets, admin credentials, frontend origin, and media URL.
npm ci
npm run prisma:generate
npm run prisma:migrate
npm run prisma:seed
npm run start:dev
```

The API runs at `http://localhost:3000`, Swagger documentation is at `/api/docs`, and readiness is available at `/api/v1/health/ready`.

The database-driven XML sitemap is available at `/api/v1/seo/sitemap.xml`. Set `PUBLIC_SITE_URL` to the canonical frontend origin so every sitemap entry points to the storefront rather than the API. API responses include `X-Robots-Tag: noindex, nofollow` because API, health, and documentation URLs should not appear in search results.

## Frontend connection

The frontend must set:

```env
VITE_API_URL=http://localhost:3000/api/v1
```

This backend must set `FRONTEND_ORIGIN` to the frontend URL. Multiple allowed origins can be supplied as a comma-separated list.

## Commands

| Command | Description |
|---|---|
| `npm run start:dev` | Start the API in watch mode |
| `npm run build` | Compile the API |
| `npm run lint` | Type-check the production source |
| `npm test` | Run unit tests |
| `npm run prisma:migrate` | Create/apply a local migration |
| `npm run prisma:deploy` | Apply committed migrations in production |
| `npm run prisma:seed` | Seed the initial admin/data |

## Docker deployment

```bash
cp .env.production.example .env.production
# Replace every placeholder and set the public frontend/API URLs.
docker compose --env-file .env.production up -d --build
```

After the first successful startup, create or update the administrator account:

```bash
docker compose --env-file .env.production exec api npm run prisma:seed
```

The backend Compose stack contains only the API and PostgreSQL. Uploaded media persists in `data/uploads`; database data persists in the named `postgres_data` volume.

## Independent deployment notes

- Expose port 3000 through your platform or reverse proxy.
- Persist `/app/uploads` when using local media storage.
- Run Prisma migrations before starting each release (the Docker image does this automatically).
- Set `MEDIA_PUBLIC_URL` to the public backend media origin, for example `https://api.shop.example.com/uploads`.
- Set `FRONTEND_ORIGIN` to the separately deployed frontend URL.
- Never commit `.env` or `.env.production`.
