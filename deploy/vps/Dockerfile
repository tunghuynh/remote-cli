# syntax=docker/dockerfile:1
#
# RemoteCLI (with the Remote feature) as a container, for a Linux VPS (Controller role).
#
# Build context = the project folder (the folder that contains package.json):
#   docker build -f deploy/vps/Dockerfile -t remotecli-remote:latest .
# or, easier, through compose:
#   docker compose -f deploy/vps/docker-compose.yml build
#
# Two stages with the SAME Debian/glibc base and Node major, so the native modules
# compiled in stage 1 (node-pty, better-sqlite3, bcrypt) load unchanged in stage 2.
# NEVER copy a node_modules folder from Windows into this build: those binaries are
# for Windows. `npm ci` below rebuilds everything for Linux.

ARG NODE_VERSION=22

# ---------------------------------------------------------------- stage 1: build
# Full (non-slim) image on purpose: it ships python3, make and g++ for node-gyp.
FROM node:${NODE_VERSION}-bookworm AS build
WORKDIR /app

# The source tree has no .git, so husky (the "prepare" script) must be switched off.
ENV HUSKY=0

# electron is a dev-only dependency (desktop wrapper) that this server image never runs;
# its postinstall would download a ~100 MB binary from GitHub (fails behind TLS-inspecting proxies).
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1

# Dependency layer first (cached until package.json / the lockfile change).
# scripts/ is needed because "postinstall" runs scripts/fix-node-pty.js.
COPY package.json package-lock.json ./
COPY scripts ./scripts
# @vscode/ripgrep's postinstall downloads its binary from GitHub (api.github.com), which is
# blocked behind some proxies. Its postinstall exits early when bin/ already exists, and the
# server only needs bin/rg, so: install without scripts, point bin/rg at Debian's ripgrep
# (installed in the runtime stage below), then run the install scripts of everything else.
RUN npm ci --ignore-scripts \
 && mkdir -p node_modules/@vscode/ripgrep/bin \
 && ln -s /usr/bin/rg node_modules/@vscode/ripgrep/bin/rg \
 && npm rebuild \
 && npm run postinstall

COPY . .
# Client (vite) -> dist/, server (tsc + tsc-alias) -> dist-server/
RUN npm run build \
 && npm prune --omit=dev

# --------------------------------------------------------------- stage 2: runtime
FROM node:${NODE_VERSION}-bookworm-slim AS runtime

# git: used by the project/git features of the UI; ca-certificates: outbound TLS;
# ripgrep: session search (node_modules/@vscode/ripgrep/bin/rg links to /usr/bin/rg).
# curl & claude-code: used by Claude Code CLI execution.
# procps: `ps` feeds the agent monitor process list; openssh-client: git over ssh URLs.
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates ripgrep curl procps openssh-client \
 && npm install -g @anthropic-ai/claude-code \
 && rm -rf /var/lib/apt/lists/*

# Everything under /app (the server locates its root through the nearest "server"
# directory and then serves ./dist from there, so keep the layout as built).
WORKDIR /app
COPY --from=build --chown=node:node /app /app

# The data directory (auth.db, remote-master.key when no env key is used, uploads).
# Created and owned by the unprivileged user so a fresh named volume inherits it.
RUN mkdir -p /home/node/.remotecli /home/node/.cloudcli && chown -R node:node /home/node/.remotecli /home/node/.cloudcli
VOLUME ["/home/node/.remotecli"]

USER node
ENV HOME=/home/node \
    HOST=0.0.0.0 \
    SERVER_PORT=3001
# HOST=0.0.0.0 is required INSIDE the container so the published port reaches it.
# Exposure to the outside is limited by the compose "ports" mapping (127.0.0.1 only).

EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.SERVER_PORT||3001)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist-server/server/index.js"]
