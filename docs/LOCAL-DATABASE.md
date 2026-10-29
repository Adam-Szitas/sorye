# Local PostgreSQL database

Performance and quality: keep local database testing optional, repeatable, and isolated from production. The default Compose database binds to loopback only and stores data in the named `sorye_pg_data` volume.

## Start the local database

From the repository root:

```powershell
pnpm db:up
pnpm db:status
```

Compose starts PostgreSQL 16 and waits for its health check. The default host endpoint is `127.0.0.1:15432`; inside the Compose network, the service is `postgres:5432`. If that host port is occupied, set `POSTGRES_PORT` in a root `.env` file (for example `15433`) before starting. The port is host-only by default (`POSTGRES_BIND_ADDRESS=127.0.0.1`).

## Point the Hub and schema tools at it

Set these in `apps/hub/.env.local`:

```dotenv
STORE_DRIVER=postgres
DATABASE_URL=postgresql://sorye:sorye@127.0.0.1:15432/sorye
```

Apply the current Drizzle schema to this local database:

```powershell
pnpm db:push
pnpm dev:hub
```

Use `pnpm db:studio` to inspect tables and rows in the configured database. For tracked migrations, use `pnpm db:generate` after schema changes and `pnpm db:migrate` to apply generated migrations. `pnpm db:push` is convenient for local development, but should not replace a reviewed migration process for staging or production.

`db:push` uses `DATABASE_URL` from the invoking environment. In PowerShell, set it for a one-off command with `$env:DATABASE_URL='postgresql://user:password@host:port/database'`. Do not point schema push at production. To stop without deleting local data, run `pnpm db:down`; `pnpm db:up` reuses the persistent volume. `pnpm db:logs` follows container logs.

## Switch database endpoints

The Hub's primary PostgreSQL endpoint is `DATABASE_URL`. Workspace-specific PostgreSQL endpoints are separately configured and encrypted by Hub; they are not accepted from API request bodies. To test a different PostgreSQL server, change the appropriate server-side connection setting, then restart Hub so the pool is created for the intended target. Keep test data and credentials separate from production.

The current schema and Drizzle adapter support PostgreSQL only. A different PostgreSQL host/database can be selected by URL. MySQL, SQLite, and other engines are not plug-compatible: each needs a separate adapter, schema/migration implementation, transaction/locking review, and compatibility test suite before it can be offered as a selectable backend.

## Safe cleanup

`pnpm db:down` stops the container and retains its volume. Deleting the volume destroys the local database; do so only when you intentionally want a clean local database and have no data to keep. Never use `docker compose down -v` as a routine stop command.

The Compose credentials are development-only defaults. The service binds to loopback to avoid exposing the database to the LAN. For Dockerized Hub development, use the Compose service DNS name `postgres` on the Compose network, not `localhost`; configure the Hub container and Postgres service on the same network.
