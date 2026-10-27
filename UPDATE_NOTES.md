# SkyMate update notes

## Changes in this delivery

- Simplified the visible top navigation so **Sign out** is the only navigation action.
- Removed links to API integrations, Payment, Flight Search, Register and Password Login from the visible sign-in/header areas.
- Fixed destination entity extraction for phrases such as “I want to go to Singapore tomorrow”.
- Improved result-count extraction for requests such as “Provide the 5 cheapest business class offers”.
- Updated booking cancellation to create a refund record when a successful payment is recorded, update the booking's refund status, and return a clear cancellation/refund message.
- Made cancellation idempotent: repeating cancellation does not restore seats or initiate another refund.
- If the provider cannot confirm a refund, the booking remains cancelled and the refund is recorded as FAILED rather than claiming a successful refund.
- Removed the uploaded `.env` from the deliverable and sanitized `.env.example` so real credentials are not repackaged.

## Validation performed

- AI-service unit tests: `python -m pytest ai-service/tests -q` — **74 passed**.
- A full backend TypeScript build and frontend production build could not be completed in this environment because JavaScript dependencies were not installed; dependency installation timed out. Run the commands below locally after installing dependencies.

```powershell
cd backend
npm install
npm run build
npm test

cd ..\frontend
npm install
npm run build
```

## Demo and provider limitations

The default `PAYMENT_PROVIDER=mock` and `AIRLINE_PROVIDER=mock` are simulations. The cancellation/refund flow records a simulated refund and shows a clear message, but it does not cancel a real airline reservation or move real money. For a live airline booking/refund, configure and test the airline and payment providers, including their cancellation/refund APIs and webhooks. Never present demo success as a real ticket or real-money refund.

## Security action required

The uploaded archive contained credential-looking values in `.env` and `.env.example`. They have been excluded/sanitized in this output. Treat any real keys/passwords from the uploaded archive as exposed and rotate them with their providers before using them again.
