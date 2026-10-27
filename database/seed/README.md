# Seed data

The Docker MySQL initialization reads `../seed.sql` from the database directory root. That file seeds 44 airports and 15 routes. After MySQL and Redis become healthy, `backend/src/services/seed.ts` generates 60 days of dated demo flights for three sample carriers, three cabin fares, and 60 seats per flight instance. It also seeds a demo customer, a coupon, and a promotion. Seed generation only creates flight inventory when the `flights` table is empty.
