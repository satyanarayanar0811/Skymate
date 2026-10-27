# Cloud deployment guide

## AWS (recommended reference architecture)
- **EKS** for frontend, backend, and AI service; use private worker nodes and an ALB Ingress Controller with ACM TLS.
- **RDS for MySQL 8.4** in private subnets with automated backups, Multi-AZ for production, encryption at rest, and private security-group rules.
- **ElastiCache for Redis 7** with TLS/authentication for OTP, refresh-token revocation, seat holds, and conversation memory.
- **ECR** for container images; GitHub Actions uses OIDC to assume a limited IAM role.
- **Secrets Manager** for DB passwords, JWT secret, and provider credentials. Do not store secrets in Git or ConfigMaps.
- **CloudWatch / Prometheus / Grafana** for logs, metrics, alerts, and uptime checks.

## Azure and GCP equivalents
| Capability | AWS | Azure | GCP |
|---|---|---|---|
| Kubernetes | EKS | AKS | GKE |
| Managed MySQL | RDS MySQL | Azure Database for MySQL Flexible Server | Cloud SQL for MySQL |
| Managed Redis | ElastiCache | Azure Managed Redis | Memorystore for Redis |
| Container registry | ECR | ACR | Artifact Registry |
| Secrets | Secrets Manager | Key Vault | Secret Manager |
| Load balancing/TLS | ALB + ACM | Application Gateway + Key Vault | Cloud Load Balancing + Certificate Manager |

Before production: replace example domains/images, configure network policy, database migrations, TLS, backups and restore drills, secret rotation, vulnerability scanning, and a tested rollback procedure. The included Kubernetes YAML is a deployment template and has not been applied to a live cluster.
