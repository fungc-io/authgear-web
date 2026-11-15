---
title: "Run Keycloak with Docker Compose: Dev and Production-Like Setups"
excerpt: "A working docker-compose.yml for Keycloak 26.8 and PostgreSQL 18 for local development, then what changes for a production-like setup: start, hostname, TLS at a proxy, proxy headers and health checks."
coverImage: ./cover.webp
publishedAt: 2026-11-15
metaTitle: "Keycloak Docker Compose: PostgreSQL, Proxy and Health Checks"
metaDescription: "Run Keycloak with Docker Compose: working docker-compose.yml with PostgreSQL for start-dev, then hostname, TLS, proxy headers and health checks for start."
category: engineering
readTime: 9
faq:
  - q: "What is the difference between start-dev and start in Keycloak?"
    a: "start-dev is development mode. It enables HTTP, turns off strict hostname checks, uses a local cache and turns off theme caching. start is production mode. It disables HTTP and expects you to configure a hostname and TLS, and it won't start until you do."
  - q: "How do I add a health check to the Keycloak container?"
    a: "Set KC_HEALTH_ENABLED=true. Health endpoints are then served on the management port, 9000. The Keycloak image has no curl, so Keycloak's docs suggest a Bash /dev/tcp check against /health/ready."
  - q: "Which PostgreSQL version does Keycloak support?"
    a: "Keycloak 26.8 supports PostgreSQL 14 to 18 and is tested with 18."
  - q: "Is Docker Compose good enough for running Keycloak in production?"
    a: "For most teams, no. Compose runs everything on one host, so you get no high availability, and backups, upgrades and failover are all manual. Keycloak's production guide says a typical production environment runs two or more instances, which usually means Kubernetes and the Keycloak Operator."
  - q: "Where do I find the Keycloak admin console in Docker?"
    a: "With the dev setup in this guide, open http://localhost:8080/admin and sign in with the bootstrap admin username and password you set in the Compose file."
---

> **tl;dr:** For local work, run `quay.io/keycloak/keycloak` with `start-dev` next to a PostgreSQL container, wait for the database with a health check, and open `http://localhost:8080/admin`. For anything production-like, switch to `start`, set a full `KC_HOSTNAME`, terminate TLS at a reverse proxy, set `KC_PROXY_HEADERS`, and health-check port 9000.

Most Keycloak Docker Compose examples online stop at `start-dev`. That gets you a login screen, but it hides almost everything that goes wrong later: hostnames, TLS, proxies and health checks.

This guide gives you two files. The first is a development setup you can copy and run. The second is a production-like setup that shows what has to change. Both use Keycloak 26.8.2 and PostgreSQL 18, current in November 2026.

## What you need

- Docker with the Compose plugin (`docker compose`, not the old `docker-compose`).
- Port 8080 free on your machine.

## The development setup

Create a folder and save this as `docker-compose.yml`:

```yaml
services:
  postgres:
    image: postgres:18
    environment:
      POSTGRES_DB: keycloak
      POSTGRES_USER: keycloak
      POSTGRES_PASSWORD: keycloak
    volumes:
      - pgdata:/var/lib/postgresql
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U keycloak -d keycloak"]
      interval: 5s
      timeout: 5s
      retries: 10

  keycloak:
    image: quay.io/keycloak/keycloak:26.8.2
    command: start-dev
    environment:
      KC_DB: postgres
      KC_DB_URL_HOST: postgres
      KC_DB_URL_DATABASE: keycloak
      KC_DB_USERNAME: keycloak
      KC_DB_PASSWORD: keycloak
      KC_BOOTSTRAP_ADMIN_USERNAME: admin
      KC_BOOTSTRAP_ADMIN_PASSWORD: admin
      KC_HEALTH_ENABLED: "true"
    ports:
      - "127.0.0.1:8080:8080"
    depends_on:
      postgres:
        condition: service_healthy

volumes:
  pgdata:
```

Start it:

```sh
docker compose up
```

When the log says Keycloak has started, open `http://localhost:8080/admin` and sign in as `admin` / `admin`.

### What each part does

- **`start-dev`** runs Keycloak in [development mode](https://www.keycloak.org/server/configuration). HTTP is on, strict hostname checks are off, the cache is local and theme caching is off. That last point matters if you're [building a custom login theme](/post/keycloak-custom-login-page/): your changes show up without a restart.
- **`KC_DB` and friends** point Keycloak at PostgreSQL. Each `KC_` variable maps to a Keycloak option: `KC_DB_URL_HOST` is `db-url-host`, and so on. Without `KC_DB`, Keycloak uses its built-in `dev-file` database, which Keycloak's [database guide](https://www.keycloak.org/server/db) says "only exists for development use-cases".
- **`KC_BOOTSTRAP_ADMIN_*`** creates a temporary admin account on first start. Once you're in, create a permanent admin user and remove the temporary one.
- **`127.0.0.1:8080:8080`** publishes the port to your machine only, so nobody else on your network can reach a Keycloak with `admin` / `admin`.
- **`depends_on` with `service_healthy`** makes Compose wait until PostgreSQL accepts connections. Without it, Keycloak can start first, fail to connect and exit.

### Why the PostgreSQL volume path looks different

From PostgreSQL 18, the official `postgres` image stores data in `/var/lib/postgresql/18/docker` and declares its volume at `/var/lib/postgresql`. Older examples mount `/var/lib/postgresql/data`, which can fail on 18. Mount the parent folder as above.

If you already have a volume created by PostgreSQL 17, the 18 image won't start on it until you upgrade the data with `pg_upgrade`. For a throwaway dev database, `docker compose down -v` deletes the volume and you start again.

### Import a realm on start-up

Clicking through the admin console every time you reset gets old quickly. Export a realm once, keep the JSON in your repo, and let Keycloak import it on start-up:

```yaml
  keycloak:
    image: quay.io/keycloak/keycloak:26.8.2
    command: start-dev --import-realm
    volumes:
      - ./realms:/opt/keycloak/data/import:ro
```

Keycloak imports every realm JSON file in `/opt/keycloak/data/import` when it starts. A realm that already exists is skipped, so you can leave the flag on.

## Add a health check for Keycloak

The PostgreSQL service has a health check. Keycloak should have one too, so Compose (and anything watching it) knows when it can serve requests.

With `KC_HEALTH_ENABLED=true`, Keycloak serves `/health/live`, `/health/ready` and `/health/started` on its [management port, 9000](https://www.keycloak.org/server/management-interface). Don't publish this port. It's for checks from inside your network.

The catch: the Keycloak image doesn't include `curl`. Keycloak's [health check guide](https://www.keycloak.org/observability/health) suggests a Bash check that opens a TCP connection directly:

```yaml
  keycloak:
    # ...as above
    healthcheck:
      test: ["CMD", "bash", "-c", '{ printf "HEAD /health/ready HTTP/1.0\r\n\r\n" >&0; grep "HTTP/1.0 200"; } 0<>/dev/tcp/localhost/9000']
      interval: 10s
      timeout: 5s
      retries: 15
      start_period: 30s
```

Run `docker compose ps` and the Keycloak container should show `healthy` after start-up.

Two cautions from the guide. This check works over plain HTTP, so it fails if the management port inherits HTTPS from Keycloak's own TLS settings. And `/health/ready` tells you whether Keycloak can take traffic. Don't use it alone to decide when to restart a container.

## What changes for a production-like setup

Switch `start-dev` to `start` and Keycloak refuses to run. Production mode is "secure by default": HTTP is off, and it expects a hostname and TLS. Here is what you add, and why.

### 1. Build an optimised image

`start` runs a build step every time the container starts, which slows start-up. Keycloak's [container guide](https://www.keycloak.org/server/containers) recommends baking build-time options into your own image instead. Save this as `Dockerfile`:

```dockerfile
FROM quay.io/keycloak/keycloak:26.8.2 AS builder
ENV KC_DB=postgres
ENV KC_HEALTH_ENABLED=true
ENV KC_METRICS_ENABLED=true
RUN /opt/keycloak/bin/kc.sh build

FROM quay.io/keycloak/keycloak:26.8.2
COPY --from=builder /opt/keycloak/ /opt/keycloak/
ENTRYPOINT ["/opt/keycloak/bin/kc.sh"]
```

Then start it with `start --optimized`. Custom providers and theme JARs go into the builder stage too.

### 2. Set the hostname

In production mode, Keycloak [won't work out its own URL](https://www.keycloak.org/server/hostname) from request headers. You must set `hostname` (or turn off `hostname-strict`, which the docs say to avoid unless your proxy overwrites the `Host` header). Use the full public URL, for example `KC_HOSTNAME=https://auth.example.com`. That fixes the scheme and port, so tokens and redirects carry the right address.

### 3. Terminate TLS at a reverse proxy

You can give Keycloak its own certificate, but it's more common to let a reverse proxy handle TLS and talk to Keycloak over HTTP inside the Docker network. That's called edge termination, and it needs two settings:

- `KC_HTTP_ENABLED=true`, because `start` turns HTTP off.
- `KC_PROXY_HEADERS=xforwarded` (or `forwarded`), so Keycloak reads the client's real IP address and protocol from the proxy's headers.

> ⚠️ **Common mistake:** setting `KC_PROXY_HEADERS` while Keycloak is still reachable directly. Anyone who can reach it can then send fake `X-Forwarded-For` headers. Only expose Keycloak through the proxy, and see `proxy-trusted-addresses` in the [reverse proxy guide](https://www.keycloak.org/server/reverseproxy).

The same guide lists which paths to expose. Expose `/realms/`, `/resources/` and `/.well-known/`. Keep `/admin/` and `/realms/master/` internal, and never proxy port 9000. The Caddyfile below does this.

### 4. Keep secrets out of the file

Move passwords into a `.env` file next to `docker-compose.yml`, and add it to `.gitignore`. Compose reads it automatically:

```sh
KC_HOST=auth.example.com
DB_PASSWORD=change-me-to-something-long
KC_ADMIN=admin
KC_ADMIN_PASSWORD=change-me-too
```

### The production-like docker-compose.yml

This version uses [Caddy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy) as the proxy, because it gets certificates automatically and sets `X-Forwarded-For`, `X-Forwarded-Proto` and `X-Forwarded-Host` by default. Nginx or Traefik work just as well.

```yaml
services:
  postgres:
    image: postgres:18
    environment:
      POSTGRES_DB: keycloak
      POSTGRES_USER: keycloak
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - pgdata:/var/lib/postgresql
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U keycloak -d keycloak"]
      interval: 5s
      timeout: 5s
      retries: 10
    restart: unless-stopped

  keycloak:
    build: .
    command: start --optimized
    environment:
      KC_DB_URL_HOST: postgres
      KC_DB_URL_DATABASE: keycloak
      KC_DB_USERNAME: keycloak
      KC_DB_PASSWORD: ${DB_PASSWORD}
      KC_HOSTNAME: https://${KC_HOST}
      KC_HTTP_ENABLED: "true"
      KC_PROXY_HEADERS: xforwarded
      KC_BOOTSTRAP_ADMIN_USERNAME: ${KC_ADMIN}
      KC_BOOTSTRAP_ADMIN_PASSWORD: ${KC_ADMIN_PASSWORD}
    depends_on:
      postgres:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "bash", "-c", '{ printf "HEAD /health/ready HTTP/1.0\r\n\r\n" >&0; grep "HTTP/1.0 200"; } 0<>/dev/tcp/localhost/9000']
      interval: 10s
      timeout: 5s
      retries: 15
      start_period: 60s
    restart: unless-stopped

  caddy:
    image: caddy:2.11
    environment:
      KC_HOST: ${KC_HOST}
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
    depends_on:
      keycloak:
        condition: service_healthy
    restart: unless-stopped

volumes:
  pgdata:
  caddy_data:
```

And the `Caddyfile`:

```text
{$KC_HOST} {
    @internal path /admin /admin/* /realms/master /realms/master/*
    respond @internal 403
    reverse_proxy keycloak:8080
}
```

Notice what's missing: the Keycloak service publishes no ports. Only Caddy faces the outside world, which is what makes trusting the proxy headers safe. The Caddyfile also returns 403 for `/admin/` and `/realms/master/`, so the admin console isn't on the public internet. Admins reach it over an internal route, such as a VPN or a separate admin hostname (see `hostname-admin` in the [hostname guide](https://www.keycloak.org/server/hostname)). Point your DNS at the host, run `docker compose up -d --build`, and Keycloak answers at `https://auth.example.com`.

## Where Docker Compose stops

The file above is production-*like*. It is a good staging box or a home lab. For a login system real users depend on, it falls short in ways no Compose setting fixes:

- **One host, no high availability.** Keycloak's [production guide](https://www.keycloak.org/server/configuration-production) says a typical production environment runs two or more Keycloak instances. If this host goes down, nobody can sign in to anything.
- **The database lives next to the app.** PostgreSQL in a container on the same machine has no failover, no point-in-time recovery and no backups unless you script them.
- **Upgrades mean downtime.** With one instance, every Keycloak upgrade stops logins while the new version migrates the database. Our [Keycloak upgrade guide](/post/keycloak-upgrade-guide/) covers how to plan those.
- **Secrets sit in a file on disk.** A `.env` file is better than hard-coding, but it's not a secrets manager.

For production, most teams move to Kubernetes with the [Keycloak Operator](https://www.keycloak.org/operator/installation) and a managed or replicated PostgreSQL. If you'd rather not run it at all, we compare the options in [managed Keycloak vs private cloud](/post/managed-keycloak-vs-private-cloud/), and the real running costs in [Keycloak pricing](/post/keycloak-pricing/).

## The same local trial with Authgear

Evaluating Keycloak? Try one alternative the same way. [Authgear](https://github.com/authgear/authgear-server) is open-source authentication under the Apache-2.0 licence, built by a UK company. It also has an official Docker Compose example for local trials:

```sh
git clone https://github.com/authgear/authgear-example-docker-compose.git
cd authgear-example-docker-compose
docker compose up
# in a second terminal
./setup.sh
```

That starts Authgear, its admin portal, PostgreSQL, Redis and MinIO. Open `http://localhost:8010` and sign in with the admin account `setup.sh` created. You can try Authgear locally in 10 minutes this way.

The same rule applies as with Keycloak: the Compose example is for local development. Production runs on Kubernetes with the official Helm chart, which takes a few hours to set up. The [self-hosting tutorial](/post/self-hosted-authentication-docker-kubernetes/) walks through both, step by step.

Two things Keycloak users usually ask:

- **Can I bring my users?** Yes. We migrate your Keycloak users with their passwords, so nobody has to reset.
- **Can I keep login data in the UK or EU?** Yes. Self-host it on infrastructure you choose, or use private cloud: we run it for you in the region you choose. Our [data sovereignty page](/solutions/data-sovereignty/) and [Keycloak alternative page](/compare/keycloak-alternative/) cover both.

**Next step:** follow the [self-hosting tutorial](/post/self-hosted-authentication-docker-kubernetes/) and have Authgear running next to your Keycloak container this afternoon.

## Frequently Asked Questions

### What is the difference between start-dev and start in Keycloak?

start-dev is development mode. It enables HTTP, turns off strict hostname checks, uses a local cache and turns off theme caching. start is production mode. It disables HTTP and expects you to configure a hostname and TLS, and it won't start until you do.

### How do I add a health check to the Keycloak container?

Set KC_HEALTH_ENABLED=true. Health endpoints are then served on the management port, 9000. The Keycloak image has no curl, so Keycloak's docs suggest a Bash /dev/tcp check against /health/ready.

### Which PostgreSQL version does Keycloak support?

Keycloak 26.8 supports PostgreSQL 14 to 18 and is tested with 18.

### Is Docker Compose good enough for running Keycloak in production?

For most teams, no. Compose runs everything on one host, so you get no high availability, and backups, upgrades and failover are all manual. Keycloak's production guide says a typical production environment runs two or more instances, which usually means Kubernetes and the Keycloak Operator.

### Where do I find the Keycloak admin console in Docker?

With the dev setup in this guide, open http://localhost:8080/admin and sign in with the bootstrap admin username and password you set in the Compose file.
