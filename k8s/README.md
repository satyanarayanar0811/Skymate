# SkyMate Kubernetes deployment

1. Build and publish `backend`, `frontend`, and `ai-service` images to your registry and replace example image names.
2. Create the `skymate` namespace and apply `configmap.yaml` plus a Secret created from `secrets.example.yaml` (never apply placeholder secrets in production).
3. Provision managed MySQL 8.4 and Redis 7 with private networking, TLS, backups, and authentication; update the ExternalName service targets and credentials.
4. Run database migrations as a controlled release step. The migration Job requires a ConfigMap named `skymate-migrations` containing the SQL migration files; create it with `kubectl create configmap skymate-migrations --from-file=database/migrations -n skymate`.
5. Apply `backend.yaml`, `ai-service.yaml`, `frontend.yaml`, `ingress.yaml`, and `hpa.yaml`. Configure cert-manager and DNS for your own domains.
6. Review readiness probes, CPU/memory requests, network policies, TLS, backup restoration, and secret management before production.

This manifest set provides deployment templates; it has not been applied to a live cluster in this environment.
