# Phase 0 tests

Backend unit tests live in `backend/test/phase0.test.ts` and are run with `cd backend && npm test`. The tests cover request-shape validation and admin authentication/authorization guards. The GitHub Actions workflow installs dependencies, runs these tests, and type-checks/builds the backend. Python agent tests remain in `ai-service/tests/`.
