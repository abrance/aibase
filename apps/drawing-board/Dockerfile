FROM node:22-alpine

RUN npm config set registry https://mirrors.cloud.tencent.com/npm/ \
 && npm install -g pnpm@10.29.3 \
 && pnpm config set registry https://mirrors.cloud.tencent.com/npm/

WORKDIR /repo

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/drawing-board/package.json ./apps/drawing-board/
COPY packages/aibase-sdk/package.json ./packages/aibase-sdk/
COPY packages/aibase/package.json ./packages/aibase/

RUN pnpm install --filter drawing-board... --config.minimumReleaseAge=0

COPY packages/aibase-sdk ./packages/aibase-sdk
COPY apps/drawing-board ./apps/drawing-board

ENV DRAWING_BOARD_HOST=0.0.0.0
ENV AIBASE_BACKEND_URL=http://aibase:3001

EXPOSE 5173

WORKDIR /repo/apps/drawing-board

CMD ["pnpm", "dev"]