# Database

Postgres 17 + PostGIS (spatial) + pgvector (embeddings). Schema is plain numbered SQL
in `db/migrations/`, applied by `scripts/migrate.py`.

## Local (Docker)

```bash
docker compose up -d --build                      # first build installs pgvector on the PostGIS image
uv run --env-file .env python scripts/migrate.py  # safe to re-run
docker exec -it moby-db psql -U moby -d moby      # poke around
```

`DATABASE_URL` in `.env` defaults to `postgresql://moby:moby@localhost:5432/moby`.
If port 5432 is taken, set `DB_PORT=5433` in `.env` and change the URL to match.
Reset from scratch: `docker compose down -v` (deletes the volume).

## Managed (Neon / Supabase)

The migrations create the extensions themselves, so the same files work unchanged.

1. Create a project/database and confirm the provider lists PostGIS and pgvector.
2. Put its connection string in `DATABASE_URL` (Neon needs `?sslmode=require`).
3. Run `scripts/migrate.py` as above.

Use a **direct** (or session-mode) connection for migrations, not a transaction-mode
pooler: the runner takes a session-level advisory lock, which pooled connections can drop.

## Adding a migration

Create the next numbered file (`0003_....sql`). Never edit one that has been applied:
the runner checksums them and will refuse.

Pending: the `reports.embedding vector(<dim>)` column, once the embedding model is chosen
and its output dimension is verified (pgvector columns have a fixed dimension).

LangGraph's Postgres checkpointer (Week 3 human-in-the-loop) creates its own tables via
its `.setup()` call; keep those out of these migrations.
