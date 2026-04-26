# Database

PostgreSQL 17 is the required persistence engine. Migration files will be added under `db/migrations` when implementation begins.

The first migration should translate the Kiro design into the required six-table schema:

- `claim_inspections`
- `claim_events`
- `journeys`
- `uploaded_photos`
- `manual_reviews`
- `notification_deliveries`

Do not place database passwords in SQL files. Use environment variables or deployment secret stores.
