# Integration Test Plan

## 目标

对已部署（Docker / Helm）的 Aibase 实例执行端到端集成测试，验证核心链路：
**健康检查 → 创建会话 → 发送 prompt → 获取模型响应**。

## 测试范围

| 测试 | 对应 API | 验证点 |
|---|---|---|
| Health | `GET /api/health` | 服务存活、opencode 内核在线 |
| Session CRUD | `POST /api/sessions` | 创建会话、会话列表查询 |
| Prompt (非流式) | `POST /api/sessions/:id/prompt` + `GET /api/sessions/:id/messages` | 发送消息、等待后轮询到 assistant 回复 |
| Prompt (流式) | `POST /api/sessions/:id/prompt/stream` | SSE 事件完整性、done 事件 |
| Skills | `GET /api/skills` | 技能列表返回正常 |
| Marketplace | `GET /api/marketplace` | 注册表可读 |

## 环境要求

| 环境变量 | 默认值 | 说明 |
|---|---|---|
| `AIBASE_TEST_URL` | `http://127.0.0.1:3001` | 被测 Aibase 地址 |
| `AIBASE_TEST_MODEL` | `opencode/deepseek-v4-flash-free` | 测试用的模型 ID |
| `AIBASE_TEST_TIMEOUT_MS` | `120000` | 等待模型响应的超时(ms) |
| `AIBASE_TEST_SKIP_LLM` | `false` | 跳过需要 LLM 调用的测试 |

## 部署前置

### Docker Compose

```bash
# 启动
AIBASE_TEST_URL=http://127.0.0.1:3001 docker compose up -d

# 等待就绪
node tests/integration/helpers.mjs wait

# 运行测试
node --test tests/integration/*.test.mjs

# 清理
docker compose down -v
```

### Helm

```bash
task helm-up

# 等待 pod Ready + port-forward 生效后运行
node --test tests/integration/*.test.mjs

# 清理
task helm-down
```

## 运行命令

```bash
# 全部集成测试
node --test tests/integration/*.test.mjs

# 仅在无 LLM key 时跳过 prompt 测试
AIBASE_TEST_SKIP_LLM=1 node --test tests/integration/*.test.mjs

# CI 中等待服务就绪后运行
node tests/integration/helpers.mjs wait && node --test tests/integration/*.test.mjs
```

## 测试文件

```
tests/integration/
├── PLAN.md                    # 本文档
├── helpers.mjs                # HTTP 工具 + wait-for-ready
├── health.test.mjs            # Health 端点
├── session-prompt.test.mjs    # 会话 + Prompt（非流式 + 流式）
└── marketplace.test.mjs       # Marketplace / Skills 只读端
```
