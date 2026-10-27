# SkyMate — Airline Ticket Reservation Chatbot

SkyMate is a locally runnable airline-booking demonstration built with Next.js 15 / React 19, Express / TypeScript, Python 3.11 / FastAPI / LangGraph, MySQL 8.4, Redis 7, Docker Compose, and GitHub Actions. It uses sample inventory and mock adapters by default. It is **not connected to a real airline/GDS and does not issue valid travel documents**.

## Windows quick start

Prerequisites: Docker Desktop with Linux containers, Git (optional), and a modern browser. No locally installed Node, Python, or MySQL is required when using Docker Compose.

1. Extract the project ZIP into a new folder.
2. Open that folder in VS Code. Confirm `docker-compose.yml` is in the current folder.
3. Create a local environment file:

   ```powershell
   Copy-Item .env.example .env
   ```

4. Edit `.env`. Keep `PAYMENT_PROVIDER=mock`, `LLM_PROVIDER=mock`, `SMS_PROVIDER=mock`, `WHATSAPP_PROVIDER=mock`, and `WEATHER_PROVIDER=mock` for an offline-friendly demo. Set a unique `JWT_SECRET` with at least 32 random characters and unique MySQL passwords before sharing the project.
5. Start the complete local stack:

   ```powershell
   docker compose up --build -d
   ```

6. Watch startup:

   ```powershell
   docker compose ps
   docker compose logs -f mysql backend ai-service frontend
   ```

7. Open the app at **http://localhost:3000**. MailHog inbox is **http://localhost:8025**. The MySQL container is mapped to host port **3307** to avoid conflicting with a local MySQL server.

Useful commands:

```powershell
docker compose logs -f backend
docker compose down
```

The MySQL and Redis named volumes persist data across container restarts. To intentionally reset all local data, run `docker compose down -v` (this deletes the database and Redis data).

## Demo access

- **Admin account:** `admin@skymate.local` / `SkyMateAdmin!2026` using the password-login API (`POST /api/auth/login`). The same email can use email OTP from the home page; MailHog receives the code. Change `DEMO_ADMIN_PASSWORD` and recreate the local database before sharing this environment.
- **Customer email OTP:** use any email address in the home-page email sign-in. With local SMTP/MailHog enabled, the 6-digit code appears at http://localhost:8025.
- **Guest:** select “Continue as guest” on the home page.
- `demo@skymate.local` is a seeded sample customer record; it has no password by default, so use OTP or register a separate account.

The admin page is at `/admin`, the profile page at `/profile`, registration at `/register`, and standalone flight search at `/flight-search`.

## Environment and adapters

`.env.example` is the only environment file included. `.env` is ignored by Git. Default provider settings are safe for local demos:

| Variable | Default | Behaviour |
|---|---|---|
| `PAYMENT_PROVIDER` | `mock` | Marks a demo payment as paid without charging money. Unsupported live modes fail closed. |
| `EMAIL_PROVIDER` | `smtp` | Sends to local MailHog (`mailhog:1025`) by default. `mock` writes development notifications to logs. |
| `LLM_PROVIDER` | `mock` | Deterministic grounded response path; `openai` requires `OPENAI_API_KEY`. |
| `SMS_PROVIDER` | `mock` | OTP/booking notices are logged locally. Set to `twilio` and configure Account SID, API key SID + secret (or Auth Token), and an SMS-enabled sender for delivery. |
| `WHATSAPP_PROVIDER` | `mock` | Mock only; no WhatsApp message is sent. |
| `CURRENCY_PROVIDER` | `static` | Uses a small fallback table; `frankfurter` enables live public rate lookup and Redis caching. |
| `WEATHER_PROVIDER` | `mock` | `open-meteo` enables public geocoding/forecast requests without an API key. |

Never commit `.env`, provider credentials, JWT secrets, or production database passwords. If a real API key or JWT secret was included in any previously shared ZIP, revoke/rotate it now.

## Implemented API groups

All API endpoints are under `http://localhost:4000/api` unless shown otherwise.

- **Health / readiness:** `/health`, `/ready`, `/metrics` (backend root); `/api/health` and `/api/ready` (frontend); `/health`, `/ready`, `/metrics` (AI service).
- **Authentication:** `/auth/send-otp`, `/auth/verify-otp`, `/auth/guest`, `/auth/register`, `/auth/login`, `/auth/logout`, `/auth/refresh`, `/auth/guest-session`, `/auth/claim-bookings`, `/auth/forgot-password`, `/auth/reset-password`, `/auth/phone-otp`, `/auth/phone-otp/verify`.
- **Flights:** `/flights`, `/search`, `/airports`, `/fares/:flightId`, `/flights/:id/seats`, `/seats/hold`, `/status/:flightNo`, `/baggage`, `/coupons/validate`.
- **Bookings:** `/bookings`, `/bookings/:ref`, `/bookings/:ref/cancel`, `/bookings/:ref/checkin`, `/bookings/:ref/boarding-pass.pdf`. Flight changes are not implemented as a self-service API yet.
- **Payments/refunds:** `/payments/order`, `/bookings/:ref/refund`, `/refunds/:ref`. The mock provider does not charge money; the generated PDF is explicitly a demo boarding pass.
- **Notifications:** `/notifications/test` is queued in BullMQ/Redis and every attempt is written to notification log tables. SMTP email can use MailHog; SMS/WhatsApp remain mock adapters.
- **AI/policy:** `/chat`, `/policy/search`, `/weather`, `/currency`, `/conversations/:sessionId/messages`. AI short-term state is stored in Redis; backend transcript messages are persisted in MySQL.
- **Admin/support:** `/admin/summary`; list/create/update endpoints for flights and airports; booking/refund views; user role/block controls; coupon/promotion controls; conversation history; versioned prompts; FAQ/AI answer editing; support-ticket workflow; revenue, route and cancellation reports; CSV and audit history. The `/admin` portal uses authenticated JSON editors. Admin resource endpoints require an admin JWT; the summary also allows support-role access.

## Database and demo inventory

`database/schema.sql` creates relational tables for roles/users/OTP, airports/routes, flights/dated flight instances/seats, bookings/passengers/seat assignments, transactions/refunds, coupons/promotions, conversations/messages, intents/entities/prompts/FAQ documents, notification logs, support tickets, audit logs, analytics events, and daily revenue. `database/migrations/` contains numbered SQL files. On a new Docker volume, MySQL applies root-level SQL initialization scripts; the backend seed service fills demo inventory and creates the demo admin account. Seed inventory contains 44 airports, 15 routes, 60 days of sample flights across three demo carriers, three cabin fare tiers and seat maps.

## Tests and CI

- Backend: `cd backend; npm install; npm test; npm run build`
- AI: `cd ai-service; pip install -r requirements.txt pytest; pytest`
- Frontend: `cd frontend; npm install; npm run build`
- CI workflow includes backend/frontend builds, Python tests, dependency audits, and Docker image builds.

## Deployment and operations

- `k8s/` contains deployment/service, ingress/TLS, HPA, migration-job, managed database/Redis connection templates, and secret templates. Replace all example image names/domains and provision managed databases and secret storage before use.
- `docs/cloud-deployment.md` outlines AWS EKS/RDS/ElastiCache/ECR and Azure/GCP equivalents.
- `k8s/monitoring/prometheus.yml` provides scrape targets for basic process-up metrics. Configure your own Prometheus/Grafana, centralized logs, uptime alerts, error tracking, backup policies, and restore drills.

See [`docs/phase-status.md`](docs/phase-status.md) for the phase-by-phase implementation and verification matrix.

## Important limitations

This is a runnable development/demo foundation, not a production-certified airline reservation system. Inventory and fares are generated sample data. Payment capture/refunds are mock unless a fully implemented provider adapter is supplied; no real airline/GDS, airline-issued e-ticket, SMS gateway, or WhatsApp provider is connected. The existing chat-first frontend and new profile/admin/search pages are functional starting screens, but the entire rich chat-driven passenger/seat/payment journey, live agent WebSocket handoff, complete admin CRUD for every table, full production-ready RAG embedding retrieval, refresh-token rotation, and end-to-end security/integration test coverage are not complete. Real service deployment and full browser-based booking acceptance testing are still required before production use.


## API integrations for the demo

SkyMate uses environment-selected adapters. Copy `.env.example` to `.env`; no external keys are required for the mock demo. The public Open-Meteo weather and Frankfurter currency endpoints are selected by default and fall back to static/demo behavior when unavailable.

| Capability | Provider switch | Credentials / demo behavior |
|---|---|---|
| Airline / flight search | `AIRLINE_PROVIDER=mock` or `amadeus` | Mock works offline. Amadeus requires test credentials (`AMADEUS_CLIENT_ID`, `AMADEUS_CLIENT_SECRET`) and uses `https://test.api.amadeus.com`. |
| Payment | `PAYMENT_PROVIDER=mock`, `stripe`, or `razorpay` | Mock never charges. Stripe uses Checkout Sessions, `STRIPE_WEBHOOK_SECRET`, and signed webhook verification (`POST /api/payments/stripe/webhook`). For local webhook testing, use Stripe CLI to forward events to `http://localhost:4000/api/payments/stripe/webhook`. Razorpay creates test orders and verifies payment signatures. |
| Maps | OpenStreetMap + Nominatim geocoding | No key; `GET /api/integrations/maps/route?from=BLR&to=DEL` geocodes airport locations, caches coordinates in Redis, and returns an OSM map/directions link. This is a visual reference, not aviation navigation. |
| Weather | `WEATHER_PROVIDER=open-meteo` or `mock` | Open-Meteo public forecast and geocoding API; no key. `GET /api/weather?city=Delhi`. |
| Currency | `CURRENCY_PROVIDER=frankfurter` or `static` | Frankfurter public API; Redis caches rates. `GET /api/currency?from=INR&to=USD&amount=1000`. |
| SMS | `SMS_PROVIDER=mock` or `twilio` | Twilio needs an AC Account SID, an SMS-enabled sender number, and either an Auth Token or API key SID + secret. Mock mode logs a demo message. |
| Email | `EMAIL_PROVIDER=smtp` or `mock` | Local SMTP is MailHog at `localhost:8025`; configure SMTP values for a real provider. |
| WhatsApp | `WHATSAPP_PROVIDER=mock` or `twilio` | Twilio WhatsApp sandbox or approved sender credentials required. |

### API endpoints for demonstrating integrations

- `GET /api/integrations/flights/search?origin=BLR&destination=DEL&date=2026-11-10&adults=1&cabin=economy`
- `GET /api/integrations/airports?q=Delhi`
- `GET /api/integrations/maps/route?from=BLR&to=DEL`
- `GET /api/weather?city=Delhi`
- `GET /api/currency?from=INR&to=USD&amount=1000`
- `POST /api/integrations/notifications/send` with `{ "channel":"email|sms|whatsapp", "to":"...", "subject":"Demo", "message":"..." }` and a valid login bearer token.
- `POST /api/payments/order` creates a mock, Stripe Checkout, or Razorpay order. Razorpay's client payment signature is verified at `POST /api/payments/razorpay/verify`.

**Demo limitation:** Amadeus test offers are not a ticket purchase. Airline ticketing needs an eligible airline/GDS booking workflow and credentials. For payments, use test keys only. Do not represent mock payments, mock flight offers, or mock notification logs as real external transactions. Provider-specific webhooks and production credential onboarding should be completed before production deployment.

### Suggested live demo sequence

1. Open `/integrations` and run airline search in mock mode; it works without provider credentials. If you have Amadeus test credentials, set `AIRLINE_PROVIDER=amadeus` in `.env` and restart with `docker compose up --build -d`.
2. Run the weather and currency examples to demonstrate key-free public APIs.
3. Click the map link to open the airport map reference.
4. Open `/payment` with a booking reference. The default mock provider safely demonstrates order creation without charging money. For a real sandbox checkout, configure Stripe test keys or Razorpay test keys and restart.
5. For local email, send OTP and inspect MailHog at `http://localhost:8025`. SMS/WhatsApp mock messages appear in backend logs; Twilio sandbox credentials enable actual test sends.
6. To test notifications directly, send a POST request to `/api/integrations/notifications/send` with a bearer token obtained by logging in, for example:
   ```json
   {"channel":"email","to":"demo@example.com","subject":"SkyMate demo","message":"Your booking is ready."}
   ```

Use only test credentials in a demo. Live provider availability varies by account, region, sender verification, and provider permissions.
