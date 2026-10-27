# Database migration notes

- `001_initial_schema.sql` is the numbered baseline schema snapshot for a new database.
- `002_seed_airports_routes.sql` seeds the airport and route reference data.
- `../schema.sql` is the canonical consolidated schema used by Docker's first-time database initialization.
- `../seed.sql` seeds airports and routes during first initialization. The backend then generates 60 days of dated demo flights and seat maps.

The Docker MySQL entrypoint runs SQL files directly under `database/` only when `mysql-data` is first created. It does not execute files recursively from this directory. For an already initialized database, back it up and apply the required migration explicitly; do not delete the named volume unless you intentionally want to erase local data.
