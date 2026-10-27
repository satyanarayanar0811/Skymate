# Python AI agent architecture

The browser sends chat messages to Express. Express proxies `/api/chat` to the Python FastAPI service. LangGraph runs:
1. intent recognition and entity extraction,
2. stateful workflow routing,
3. tool calls to the backend for flight search, flight status and support,
4. optional OpenAI wording refinement that must preserve grounded facts and demo caveats.

Run the Python service:
```bash
cd ai-service
python -m venv .venv
# Windows PowerShell: .venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```
API docs: http://localhost:8000/docs
Tests: `pytest`

Conversation memory is currently in-process and resets on restart. Replace it with a persistent LangGraph checkpointer and shared storage for deployment. The RAG endpoint is a scaffold; it is not a completed retrieval pipeline yet.
