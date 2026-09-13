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

Products retain UUID primary keys internally and also have permanent, unique URL slugs. Slugs are generated from the English name when a product is created and do not change automatically when its name is edited. Public product lookup accepts either a slug or a legacy UUID.

Product prices support Ethiopian birr (`ETB`) and US dollars (`USD`). New products and migrated existing products default to `ETB`; the selected currency is returned with every product response.

Administrators can generate reviewable Amharic and Afaan Oromo product-translation drafts with Google Cloud Translation Basic. Configure `GOOGLE_TRANSLATE_API_KEY` only on the backend; the browser never receives it. The draft endpoint does not write to PostgreSQL. Translations are stored only after the administrator reviews them and submits the normal product form.

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

### Product-slug migration

Migration `202609030001_product_slugs` adds the required unique `products.slug` column and backfills existing rows with readable values. Name collisions receive numeric suffixes such as `nike-shoe-2`. The container runs `prisma migrate deploy` before starting the API, so normal backend deployment applies this migration automatically.

Before deploying this migration, create a PostgreSQL backup. Deploy the backend before the frontend: the updated backend remains compatible with the old UUID-based frontend, while the updated frontend requires product slugs in API responses.

### Product-currency migration

Migration `202609050001_product_currency` adds an `ETB`/`USD` currency to every product. Existing products are marked as `ETB`, and PostgreSQL defaults new records to `ETB`. Deploy the backend before the currency-aware frontend because the older backend rejects unknown request fields.

### Product-size migration

Migration `202609130001_product_sizes` adds the product size type, its available
sizes, and the size selected on an inquiry. Existing products default to no size
selection and existing inquiries keep a null selected size. The Docker container
applies this migration automatically before starting the updated API.

Deploy the backend before the size-aware frontend. After both deployments, edit
each applicable product in the admin area, select its size type and available
sizes, and save it. Products left as **No selectable size** continue to accept
inquiries without asking the shopper for a size.

### Related-product recommendations

The public `GET /api/v1/products/:identifier/related` endpoint ranks products by
matching brand first, similar model/name words second, and category third. Common
color words are ignored during name comparison so color variants stay close
together. Migration `202609130002_product_recommendations` adds an index for the
brand lookup and is applied automatically during backend deployment.

### Product-family and color-variant migration

Migration `202609130003_product_color_variants` groups separate product records under
one brand and model code. Every color remains an independent product with its own
URL, images, price, stock status, and available sizes. Existing products remain
standalone until an administrator assigns a model code and color. Inquiry rows
store a color snapshot so the selected color remains visible if the product is
later edited or deleted.

Deploy the backend before the frontend. After deployment, edit an existing
product and add its brand, model code, family name, and color. Use **Duplicate as
another color** to create its other colors without copying the original images.

## Independent deployment notes

- Expose port 3000 through your platform or reverse proxy.
- Persist `/app/uploads` when using local media storage.
- Run Prisma migrations before starting each release (the Docker image does this automatically).
- Set `MEDIA_PUBLIC_URL` to the public backend media origin, for example `https://api.shop.example.com/uploads`.
- Set `FRONTEND_ORIGIN` to the separately deployed frontend URL.
- Never commit `.env` or `.env.production`.
- Restrict the Google API key to the Cloud Translation API and the VPS public IP address. Rotate it periodically and never expose it through a frontend `VITE_*` variable.
