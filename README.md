# Center of AI (CAI) DevOps Dev Hub

This repository contains the source code and configuration for the **CAI Dev Hub Portal & DevOps Getting Started Guide**. It runs as a dockerised service on our Contabo development server.

## Features

- **System Status Board**: Simulated live metrics for monitoring VPS status.
- **Port Registry**: Complete overview of allocated and staging ports (e.g., Caddy on 80/443, Dev Hub on 8001, staging applications).
- **Reference Guides**: Searchable cheat sheets for login commands, SSH credentials, private repository setup, `.env` file management, and gitignores.
- **Interactive Script & Configuration Generator**: Dynamically outputs setup scripts, custom `Dockerfile`, `docker-compose.yml`, and `Caddyfile` reverse proxy configurations based on developer inputs.
- **Troubleshooting Database**: Categorized error outputs with actionable root causes and resolutions.

---

## Getting Started

### Local Setup & Launch

To start the Dev Hub on your local setup or on the server:

1. Clone this repository (if not already done):
   ```bash
   git clone git@github.com:cai-dev/cai-dev-server.git
   cd cai-dev-server
   ```

2. Build and launch the container in detached mode using Docker Compose:
   ```bash
   docker-compose up -d --build
   ```

3. Open your browser and navigate to:
   ```text
   http://localhost:8001
   ```

---

## DevOps Compliance Standards

Please adhere to these guidelines to ensure server stability:

1. **The Minimum Exposure Rule**:
   Only ports `80` (HTTP) and `443` (HTTPS) should be exposed publicly on the server firewall. Caddy manages SSL certification and acts as the entrypoint reverse-proxy. Bind individual docker applications internally using `-p 127.0.0.1:<PORT>:<PORT>` so they cannot be accessed directly from the host IP.
2. **Every Project has a Unique Port**:
   Coordinate with the team to avoid port clashes. Staging projects are allocated ports within the `8010`–`8090` block. Check the active port registry on the portal, choose an open port, and update this repository.
3. **Strict Folderization**:
   Organize staging apps inside the `~/cai-apps` folder (e.g. `~/cai-apps/project-name`). Do not put projects in root or temp directories.
4. **Gitignore hygiene**:
   Always use a proper `.gitignore` file. Never commit `.env` files, SSH keys, node modules, build artifacts, or secret variables.
5. **No direct host processes**:
   Run every application inside Docker to prevent version mismatches, memory leak failures, or dependency conflicts.
