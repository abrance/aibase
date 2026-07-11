ARG NODE_IMAGE=node:22-bookworm-slim
FROM ${NODE_IMAGE}

ARG OPENCODE_VERSION=latest
ARG OMO_VERSION=latest
ARG OMO_SUBSCRIPTIONS="--claude=max20 --gemini=yes --copilot=no"

ENV NODE_ENV=production \
    AIBASE_HOST=0.0.0.0 \
    AIBASE_PORT=3001 \
    AIBASE_WORKSPACE=/workspace \
    AIBASE_SKILLS_DIR=/app/skills \
    AIBASE_MCP_DIR=/app/mcp \
    AIBASE_MCP_AUTO_REGISTER=true \
    OPENCODE_BIN=opencode \
    OPENCODE_HOST=127.0.0.1 \
    OPENCODE_START_TIMEOUT_MS=30000 \
    HOME=/home/aibase \
    XDG_CONFIG_HOME=/home/aibase/.config \
    XDG_DATA_HOME=/home/aibase/.local/share

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      bash \
      build-essential \
      ca-certificates \
      curl \
      git \
      openssh-client \
      python3 \
      python3-pip \
      ripgrep \
      sudo \
      unzip \
      jq \
    && rm -rf /var/lib/apt/lists/*

RUN pip3 install --break-system-packages cryptography -i https://pypi.mirrors.ustc.edu.cn/simple/ 

RUN npm install -g "opencode-ai@${OPENCODE_VERSION}" bun
RUN bunx "oh-my-openagent@${OMO_VERSION}" install --no-tui --platform=both ${OMO_SUBSCRIPTIONS} \
    && npm cache clean --force \
    && rm -rf /tmp/* /root/.bun /root/.npm

RUN groupadd --gid 10001 aibase \
    && useradd --uid 10001 --gid 10001 --create-home --shell /bin/bash aibase \
    && mkdir -p /app /workspace /app/repo /home/aibase/.config/opencode /home/aibase/.local/share/opencode \
    && chown -R aibase:aibase /app /workspace /app/repo /home/aibase \
    && echo "aibase ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/aibase \
    && chmod 440 /etc/sudoers.d/aibase

WORKDIR /app

COPY --chown=aibase:aibase package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --chown=aibase:aibase src ./src
COPY --chown=aibase:aibase public ./public
COPY --chown=aibase:aibase skills ./skills
COPY --chown=aibase:aibase mcp ./mcp
COPY --chown=aibase:aibase docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

RUN node --check src/server.mjs \
    && node --check src/mcp/openapi-docs.mjs \
    && node --check src/mcp/openapi_mcp_server.mjs \
    && opencode --version

USER aibase

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.AIBASE_PORT || 3001) + '/api/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["node", "src/server.mjs"]
