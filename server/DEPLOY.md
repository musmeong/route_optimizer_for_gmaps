# Deploying with Cloudflare Tunnel (Example in my VPS: Ubuntu 24.04 + Docker)

Since you're already using Cloudflare Tunnels for other services,
this is much simpler than the traditional nginx + certbot approach.
Cloudflare handles SSL, DDoS protection, and routing automatically.

---

## Step 1 — Copy server files to VPS

```bash
# From your local machine
scp -r server/ user@YOUR_VPS_IP:~/route-optimizer/
ssh user@YOUR_VPS_IP
cd ~/route-optimizer
```

---

## Step 2 — Start the optimizer container

```bash
docker compose up -d --build
```

Verify it's running:
```bash
curl http://localhost:5748/ping
# → {"status": "ok", "engine": "OR-Tools"}
```

---

## Step 3 — Add to Cloudflare Tunnel

### Option A: Zero Trust dashboard (most common)

1. Go to Cloudflare Zero Trust → Networks → Tunnels
2. Click your existing tunnel → Edit → Public Hostnames tab
3. Click "Add a public hostname"
4. Fill in:
      Subdomain : optimizer
      Domain    : (YOUR DOMAIN)
      Service   : HTTP   localhost:5748
5. Save — the DNS Tunnel record is created automatically ✅

### Option B: cloudflared config file on VPS

Open your config.yml and add a rule before the catch-all:

```yaml
ingress:
  # ... existing rules (chat, images, openclaw) ...

  - hostname: optimizer.(YOUR DOMAIN)
    service: http://localhost:5748

  - service: http_status:404   # keep this last
```

Then restart:
```bash
sudo systemctl restart cloudflared
```

---

## Step 4 — Reload the Chrome extension

Go to chrome://extensions → find the extension → click the refresh icon.
Open Google Maps → add stops → dot should be green (OR-Tools online).

---

## Useful commands

```bash
docker compose logs -f optimizer       # live logs
docker compose restart optimizer       # restart
docker compose up -d --build optimizer # rebuild after code changes
```
