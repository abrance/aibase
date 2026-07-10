# aibase-sdk

浏览器端轻量 SDK，零依赖，通过 ES module 或 `<script>` 标签引入。

## 安装

直接复制 `aibase-sdk.js` 到项目中，无需 npm install。

```html
<script type="module">
  import { createAibaseClient } from "./aibase-sdk.js";
</script>
```

## 初始化

```js
const api = createAibaseClient({
  baseUrl: "http://localhost:3001", // aibase 的地址（必填）
});
```

## API 参考

### `api.health()`

健康检查。返回 aibase 和 opencode 的运行状态。

```js
const h = await api.health();
// {
//   name: "aibase",
//   status: "ok",          // "ok" | "opencode_unavailable"
//   workspace: "/path/to/workspace",
//   skillsRoot: "/path/to/skills",
//   mcpRoot: "/path/to/mcp",
//   environmentBaseURL: "...",
//   opencode: { url: "...", exit: null }
// }
```

---

### Sessions

所有 session 相关方法挂在 `api.sessions` 下。

#### `api.sessions.list(opts?)`

列出 session。

```js
const sessions = await api.sessions.list();
// 可选参数
const sessions = await api.sessions.list({
  archived: true,           // 是否包含已归档
  search: "关键词",          // 搜索
  limit: 20,                // 数量（默认 40）
});
```

#### `api.sessions.create({ title?, permission? })`

创建新 session。

```js
const session = await api.sessions.create({ title: "画板协作" });
console.log(session.id); // "ses_abc123"
```

#### `api.sessions.getMessages(sessionId, limit?)`

获取历史消息。

```js
const messages = await api.sessions.getMessages("ses_abc123", 50);
// messages 是消息数组
```

#### `api.sessions.prompt(sessionId, body)`

发送 prompt（非流式，一次性返回完整结果）。

```js
const result = await api.sessions.prompt("ses_abc123", {
  text: "帮我写一个排序函数",
  agent: "build",            // 可选，指定 agent
  model: "openai/gpt-4o",   // 可选，指定模型
  system: "用 TypeScript",   // 可选，system message
});
```

#### `api.sessions.promptStream(sessionId, body, onEvent)`  ⭐

发送 prompt 并接收 SSE 流式响应。这是最常用的方法。

```js
await api.sessions.promptStream(
  "ses_abc123",
  { text: "帮我画一个圆形" },
  (event, data) => {
    switch (event) {
      case "phase":
        // 进度提示，如 "正在分析"、"正在生成"、"正在调用工具"
        console.log("[阶段]", data.label);
        break;

      case "assistant":
        // 模型增量输出
        // data: { messageID, text }
        console.log(data.text);
        break;

      case "permission":
        // 工具权限请求，需要用户确认
        // data: { id, type, pattern, title, command }
        console.log("请求权限:", data.title);
        // 允许或拒绝：
        // await api.sessions.respondPermission(sessionId, data.id, true);
        break;

      case "trace":
        // 调试追踪信息（用于 UI 时间线）
        // data: { kind, label, detail, time }
        break;

      case "accepted":
        // prompt 已被 kernel 接受，模型开始处理
        break;

      case "error":
        // 错误
        console.error(data.message);
        break;

      case "messages":
        // 最终完整消息列表（流结束前发送）
        break;

      case "done":
        // 流结束
        console.log("完成");
        break;
    }
  },
);
```

**SSE 事件速查：**

| event | data 关键字段 | 说明 |
|---|---|---|
| `phase` | `{ label }` | 当前阶段，如 `"正在分析"` / `"正在生成"` / `"正在调用工具"` |
| `assistant` | `{ messageID, text }` | 模型增量文本（累积） |
| `permission` | `{ id, type, pattern, title, command }` | 工具执行权限请求 |
| `trace` | `{ kind, label, detail, time }` | 调试追踪信息 |
| `accepted` | `{}` | 请求已被接受 |
| `error` | `{ message }` | 错误信息 |
| `messages` | `[...]` | 完整消息数组 |
| `done` | `{}` | 流结束 |

#### `api.sessions.updateTitle(sessionId, title)`

修改标题。

```js
await api.sessions.updateTitle("ses_abc123", "新标题");
```

#### `api.sessions.archive(sessionId, archived?)`

归档 / 取消归档。

```js
await api.sessions.archive("ses_abc123", true);  // 归档
await api.sessions.archive("ses_abc123", false); // 取消归档
```

#### `api.sessions.respondPermission(sessionId, permissionId, allow)`

响应权限请求。在收到 `permission` 事件后调用。

```js
await api.sessions.respondPermission("ses_abc123", "perm_xyz", true); // 允许
await api.sessions.respondPermission("ses_abc123", "perm_xyz", false); // 拒绝
```

---

## 完整示例

### 示例 1：最小聊天组件

```js
import { createAibaseClient } from "./aibase-sdk.js";

const api = createAibaseClient({ baseUrl: "http://localhost:3001" });

async function chat(text) {
  const session = await api.sessions.create({ title: text.slice(0, 30) });

  await api.sessions.promptStream(
    session.id,
    { text },
    (event, data) => {
      if (event === "assistant") {
        document.getElementById("output").textContent = data.text;
      }
    },
  );
}

document.getElementById("send").onclick = () => {
  const text = document.getElementById("input").value;
  chat(text);
};
```

### 示例 2：在画板中嵌入 AI 侧边栏

```html
<div id="ai-sidebar">
  <div id="chat-messages"></div>
  <textarea id="user-input"></textarea>
  <button id="send-btn">发送</button>
</div>

<script type="module">
  import { createAibaseClient } from "./aibase-sdk.js";

  const api = createAibaseClient({ baseUrl: "http://localhost:3001" });
  let currentSessionId = null;

  // 初始化一个 session
  async function initSession() {
    const session = await api.sessions.create({ title: "画板 AI 助手" });
    currentSessionId = session.id;
    addSystemMsg("AI 助手已就绪，你可以让我帮你画图、修改颜色、调整布局等。");
  }

  function addUserMsg(text) {
    const el = document.createElement("div");
    el.className = "msg user";
    el.textContent = text;
    document.getElementById("chat-messages").appendChild(el);
  }

  function addAiMsg(text) {
    let el = document.querySelector(".msg.ai.streaming");
    if (!el) {
      el = document.createElement("div");
      el.className = "msg ai streaming";
      document.getElementById("chat-messages").appendChild(el);
    }
    el.textContent = text;
  }

  function addSystemMsg(text) {
    const el = document.createElement("div");
    el.className = "msg system";
    el.textContent = text;
    document.getElementById("chat-messages").appendChild(el);
  }

  async function sendPrompt(text) {
    if (!currentSessionId) await initSession();
    addUserMsg(text);

    await api.sessions.promptStream(
      currentSessionId,
      { text },
      (event, data) => {
        switch (event) {
          case "assistant":
            addAiMsg(data.text);
            break;
          case "permission":
            // 自动允许工具调用
            api.sessions.respondPermission(currentSessionId, data.id, true);
            break;
          case "done":
            document.querySelector(".msg.ai.streaming")
              ?.classList.remove("streaming");
            break;
          case "error":
            addSystemMsg(`错误: ${data.message}`);
            break;
        }
      },
    );
  }

  document.getElementById("send-btn").onclick = () => {
    const text = document.getElementById("user-input").value.trim();
    if (text) sendPrompt(text);
    document.getElementById("user-input").value = "";
  };

  initSession();
</script>
```

### 示例 3：处理工具权限（弹窗确认）

```js
async function sendWithPermission(text) {
  const session = await api.sessions.create({ title: text });
  let pendingPermission = null;

  await api.sessions.promptStream(
    session.id,
    { text },
    (event, data) => {
      switch (event) {
        case "assistant":
          console.log(data.text);
          break;
        case "permission":
          // 暂停，等待用户确认
          pendingPermission = data;
          break;
        case "done":
          break;
      }
    },
  );

  // 处理权限请求
  if (pendingPermission) {
    const allowed = confirm(`允许执行: ${pendingPermission.title}?`);
    await api.sessions.respondPermission(
      session.id,
      pendingPermission.id,
      allowed,
    );
  }
}
```

---

## 注意事项

1. **CORS**：如果从不同 origin 访问 aibase，需要 aibase 服务端配置 CORS 头。当前 aibase 默认不开启 CORS，需要修改 `src/server.mjs` 添加 `Access-Control-Allow-Origin` 头。

2. **依赖**：SDK 零依赖，仅使用浏览器原生 `fetch` 和 `ReadableStream` API，适用于所有现代浏览器。

3. **`promptStream` 的回调**：`onEvent` 回调在 `done` 事件后不会再被调用。如果需要在流结束后处理 `messages` 事件里的完整消息列表，在收到 `messages` 事件时处理（`messages` 在 `done` 之前发送）。
