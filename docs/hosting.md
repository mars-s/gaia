# Hosting: Avi's homelab

Requirements for running Gaia on `mars` (Proxmox). These are v0.1 musts in `SPEC.md`.

## Container

- Separate unprivileged LXC on mars.
- Node runs natively under systemd. Docker-in-LXC works but is not preferred.
- Resources: 2 vCPU, 512 MB swap, 16 GB disk on `local-lvm`. No fixed RAM limit.
- Size RAM for the runtime, builds and checks. Avi will free homelab capacity as needed; the earlier 1 GB allocation and 1.9 GB headroom are not constraints.

## Data

- One configurable data dir, default `/var/lib/gaia`.
- It holds all data and the git repo Gaia modifies, so a backup is one directory.

## Network

- Private access only, via Tailscale and Caddy at `gaia.avi`.
- Gaia serves plain HTTP behind the proxy; Caddy handles the front.
- Configurable bind address and port, plus trusted reverse proxy support (forwarded headers only from the configured proxy).
- Avoid ports 8096, 8264 and 8090.
- Outbound HTTPS only.

## Operations

- Ship a systemd unit or a single start command.
- Health endpoint (for example `GET /healthz`) for the supervisor, Caddy and monitoring.
