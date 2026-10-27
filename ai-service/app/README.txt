SkyMate AI conversation-flow fixes

Files in this folder are replacement files for:
- ai-service/app/intent_engine.py
- ai-service/app/graph.py
- ai-service/app/main.py

These were prepared from the supplied SkyMate production project copy. The fixes add written-date parsing and ensure the graph validates dates before calling the flight provider. The existing Redis context merge in main.py/graph.py is retained.

Before replacing files in your working project:
1. Back up the three original files.
2. Copy each file to the matching path under ai-service/app/.
3. Run: docker compose exec ai-service python -m compileall -q app
4. Run the test command below.
5. Exercise the multi-turn flow with a unique conversation ID before relying on it.

Smoke test (from the ai-service container):
python -c "from app.intent_engine import extract_entities; print(extract_entities('15 November 2026')); print(extract_entities('November 15, 2026')); print(extract_entities('2026-11-15'))"

Important: this is a targeted code update, not a certification of production readiness. Full end-to-end tests against the configured airline provider are still required. Do not replace .env or recreate database volumes.
