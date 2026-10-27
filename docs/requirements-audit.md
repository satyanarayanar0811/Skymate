# Airline reservation chatbot requirements audit

Status checked against this repository on 2026-10-26. “Demo” means implemented against local sample data or a mock provider; it does not claim a real reservation, payment, refund, or airline document.

## Customer journey

| Requirement | Status | Notes |
|---|---|---|
| Welcome, sign-in, registration, guest booking | Implemented (demo) | Email OTP, password login/register and guest session are available. |
| One-way and round-trip search | Implemented (search) | Local inventory and Amadeus offers can be searched; both legs are not issued as a combined reservation. |
| Passenger count, cabin and calendar dates | Implemented | Workspace has selectors/date inputs; conversational collection is available for the booking draft. |
| Fare comparison | Implemented (estimated) | Uses returned sample/provider offers; fares and availability require provider confirmation. |
| Seat selection | Partial | Local workspace has a simple seat selector/hold API. The conversational provider-offer booking does not reserve a live seat. |
| Passenger detail capture and booking review | Implemented (demo) | Chat flow parses passenger fields and shows a draft before the mock-payment step. |
| Payment and booking confirmation | Implemented (mock/provider adapter) | Mock payment is not a charge. A configured payment provider and webhook are required for a real payment. |
| Email/SMS/WhatsApp confirmation and cancellation | Implemented in code; provider setup required | Email can use SMTP. Phone notifications require valid Twilio credentials, enabled senders and recipient eligibility. Current `.env` is mock mode. |
| Booking change | Missing | No self-service booking-modification endpoint/workflow is implemented. |
| Cancellation and refund status | Implemented (demo) | Local cancellation/refund records are supported. No real airline cancellation or money movement is implied. |
| Check-in and boarding-pass download | Implemented (demo) | The PDF is clearly marked not valid for travel; real check-in belongs to the operating airline. |
| Baggage and flight status | Partial | Sample status and generic baggage guidance only; no live operating-airline feed/rules. |
| Customer support escalation | Partial | Support tickets and an admin queue exist; no live agent/WebSocket handoff or satisfaction workflow. |

## Services and operations

| Requirement | Status | Notes |
|---|---|---|
| Flight/airport/fare/seat APIs | Implemented (demo) | Local MySQL data and optional Amadeus search adapter; no airline ticketing integration. |
| User management and OTP | Implemented (partial) | Registration, login, email OTP, guest sessions and phone OTP APIs exist; full token rotation and exhaustive OTP abuse controls remain. |
| Payment/refund gateways | Partial | Mock, Stripe and Razorpay adapters are present; provider accounts, webhook configuration and provider acceptance validation are external setup. |
| SMS/WhatsApp gateway | Partial | Twilio adapters and API-key authentication are implemented; current mock sender values cannot deliver messages. |
| Maps, weather and currency | Implemented (reference integrations) | OSM route links, Open-Meteo and Frankfurter/static fallback are available; these do not provide aviation navigation or guaranteed live rates. |
| AI intents, extraction and memory | Implemented (partial) | Intent/entity handling and Redis context exist. Robust summary memory, vector retrieval and complete tool-driven booking changes remain. |
| Admin portal | Implemented (partial) | Admin-only records portal and APIs cover inventory, users, promotions/coupons, prompts/FAQ, conversations, support and reports. Booking/refund views are read-only; forms use JSON rather than dedicated domain editors. |
| MySQL, Redis, logs, health checks, CI and Docker | Implemented | Local stack builds and runs. The current deployment is not a production cloud deployment. |
| Kubernetes/cloud deployment/monitoring | Templates only | Manifests and deployment guidance exist; no cluster, dashboards, backups, alerting, or production rollout is configured. |

## Remaining external or product work

1. Connect an airline/GDS provider that supports booking, seat assignment, changes, cancellation, check-in and ticket issuance; search-only offers are insufficient to fulfill a real ticket.
2. Complete the two-leg round-trip booking and conversational seat-selection/booking-change workflows.
3. Configure and validate payment, email, SMS and WhatsApp provider accounts, senders, webhooks, recipient consent and delivery status.
4. Add live-agent handoff, proper passenger/booking ownership controls, dedicated admin forms, and end-to-end browser acceptance tests.
5. Deploy to a cloud environment with managed secrets, TLS, persistent backups, monitoring and an exercised restore/rollback plan.
