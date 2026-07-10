import { useState, useEffect, useRef, useCallback } from "react";
import { createAibaseClient } from "@aibase/sdk";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { convertToExcalidrawElements, newElementWith } from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/types";
import "./AISidebar.css";

interface CanvasElement {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  text: string | null;
}

interface ChatMessage {
  role: "user" | "assistant" | "system";
  text: string;
}

interface AISidebarProps {
  open: boolean;
  elements: CanvasElement[];
  excalidrawAPI: ExcalidrawImperativeAPI | null;
  onClose: () => void;
}

interface SseData {
  text?: string;
  id?: string;
  message?: string;
  messages?: Array<{ role: string; content: string }>;
}

const api = createAibaseClient({ baseUrl: import.meta.env.VITE_AIBASE_URL || "" });

// ── Drawing helpers ──────────────────────────────────────────────────────

interface ShapeDef {
  type: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  text?: string;
  strokeColor?: string;
  backgroundColor?: string;
  fontSize?: number;
  points?: Array<[number, number]>;
}

const PALETTE = [
  { stroke: "#2563eb", fill: "#dbeafe" },
  { stroke: "#16a34a", fill: "#dcfce7" },
  { stroke: "#d97706", fill: "#fef3c7" },
  { stroke: "#dc2626", fill: "#fee2e2" },
  { stroke: "#7c3aed", fill: "#ede9fe" },
  { stroke: "#0891b2", fill: "#cffafe" },
  { stroke: "#be185d", fill: "#fce7f3" },
  { stroke: "#475569", fill: "#f1f5f9" },
];

/** Extract keywords from AI response text */
function extractKeywords(text: string): string[] {
  const keywords: string[] = [];

  // Architecture terms (Chinese + mixed)
  const termRegex = /([\u4e00-\u9fa5\w]+(?:层|模块|服务|系统|组件|网关|代理|中心|平台|引擎|库|API|DB|Agent|Client|Server|Service|Gateway|Module|Engine|Layer|UI|前端|后端))/g;
  let match;
  while ((match = termRegex.exec(text)) !== null) {
    const term = match[1].trim();
    if (term.length >= 2 && !keywords.includes(term)) {
      keywords.push(term);
    }
  }

  // Generic Chinese compounds
  if (keywords.length === 0) {
    const genericRegex = /([\u4e00-\u9fa5]{2,8}(?:系统|平台|服务|模块|组件|引擎|工具|中心|层|界面|管理))/g;
    while ((match = genericRegex.exec(text)) !== null) {
      if (!keywords.includes(match[1])) keywords.push(match[1]);
    }
  }

  // Fallback: split by punctuation
  if (keywords.length === 0) {
    const segments = text.split(/[，,、。.！!\n]/).filter((s) => s.trim().length > 4);
    for (const seg of segments.slice(0, 6)) {
      const short = seg.replace(/[，,、。.！!\n]/g, "").trim().slice(0, 12);
      if (short.length >= 2) keywords.push(short);
    }
  }

  return [...new Set(keywords)].slice(0, 6);
}

/** Generate shapes (rectangles + arrows) from extracted keywords */
function generateShapesFromText(text: string, existingCount: number): ShapeDef[] {
  const keywords = extractKeywords(text);
  const unique = keywords.length > 0 ? keywords : ["系统架构", "前端", "后端", "数据库"];

  const startX = 100 + (existingCount > 0 ? 40 : 0);
  const startY = 100 + (existingCount > 0 ? 40 : 0);
  const boxW = 160;
  const boxH = 56;
  const gapX = 40;
  const gapY = 40;
  const cols = Math.min(unique.length, 2);

  const shapes: ShapeDef[] = [];

  // Generate rectangles
  unique.forEach((label, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const c = PALETTE[i % PALETTE.length];
    shapes.push({
      type: "rectangle",
      x: startX + col * (boxW + gapX),
      y: startY + row * (boxH + gapY),
      width: boxW,
      height: boxH,
      text: label,
      strokeColor: c.stroke,
      backgroundColor: c.fill,
      fontSize: 16,
    });
  });

  // Generate connector arrows
  for (let i = 0; i < unique.length; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const cx = startX + col * (boxW + gapX) + boxW / 2;
    const cy = startY + row * (boxH + gapY) + boxH / 2;

    // Down arrow
    const nextSameCol = i + cols;
    if (nextSameCol < unique.length) {
      const nextRow = Math.floor(nextSameCol / cols);
      const ncy = startY + nextRow * (boxH + gapY) + boxH / 2;
      shapes.push({
        type: "arrow",
        x: cx,
        y: cy + boxH / 2 + 4,
        points: [[0, 0], [0, ncy - cy - boxH / 2 - 4]],
        strokeColor: "#94a3b8",
      });
    }

    // Right arrow
    if (col === 0 && (i + 1) % cols === 1 && i + 1 < unique.length) {
      shapes.push({
        type: "arrow",
        x: cx + boxW / 2 + 4,
        y: cy,
        points: [[0, 0], [gapX - 8, 0]],
        strokeColor: "#94a3b8",
      });
    }
  }

  return shapes;
}

/**
 * Draw shapes onto the Excalidraw canvas.
 * Uses convertToExcalidrawElements to create elements, then
 * applies colors via newElementWith since convertToExcalidrawElements
 * doesn't forward strokeColor/backgroundColor.
 */
function drawShapes(eapi: ExcalidrawImperativeAPI, shapes: ShapeDef[]) {
  for (const s of shapes) {
    if (s.type === "arrow" || s.type === "line") {
      const skeleton: Record<string, unknown> = {
        type: s.type,
        x: s.x,
        y: s.y,
        points: s.points ?? [[0, 0], [80, 0]],
      };
      const elements = convertToExcalidrawElements([skeleton as never]);
      if (elements.length > 0) {
        const colored = s.strokeColor
          ? newElementWith(elements[0] as ExcalidrawElement, {
              strokeColor: s.strokeColor,
            } as Record<string, unknown>)
          : elements[0];
        eapi.updateScene({ elements: [colored] });
      }
    } else {
      const skeleton: Record<string, unknown> = {
        type: s.type,
        x: s.x,
        y: s.y,
        width: s.width ?? 160,
        height: s.height ?? 60,
      };
      if (s.text) skeleton.text = s.text;
      if (s.fontSize) skeleton.fontSize = s.fontSize;

      const elements = convertToExcalidrawElements([skeleton as never]);
      if (elements.length > 0) {
        const updates: Record<string, unknown> = {};
        if (s.strokeColor) updates.strokeColor = s.strokeColor;
        if (s.backgroundColor) updates.backgroundColor = s.backgroundColor;
        const colored = Object.keys(updates).length > 0
          ? newElementWith(elements[0] as ExcalidrawElement, updates)
          : elements[0];
        eapi.updateScene({ elements: [colored] });
      }
    }
  }
}

/** Try to parse JSON drawing instructions from AI response */
function tryParseDrawingJson(text: string): ShapeDef[] | null {
  const jsonBlockRegex = /```(?:json)?\s*(\{[\s\S]*?\})\s*```/;
  const match = jsonBlockRegex.exec(text);
  if (!match) return null;

  try {
    const parsed = JSON.parse(match[1]);
    const rawShapes = parsed.shapes || parsed.elements || [];
    if (!Array.isArray(rawShapes) || rawShapes.length === 0) return null;
    return rawShapes.map((s: Record<string, unknown>) => ({
      type: String(s.type ?? "rectangle"),
      x: Number(s.x ?? 100),
      y: Number(s.y ?? 100),
      width: s.width !== undefined ? Number(s.width) : undefined,
      height: s.height !== undefined ? Number(s.height) : undefined,
      text: s.text !== undefined ? String(s.text) : undefined,
      strokeColor: s.strokeColor !== undefined ? String(s.strokeColor) : undefined,
      backgroundColor: s.backgroundColor !== undefined ? String(s.backgroundColor) : undefined,
      fontSize: s.fontSize !== undefined ? Number(s.fontSize) : undefined,
      points: Array.isArray(s.points) ? (s.points as Array<[number, number]>) : undefined,
    }));
  } catch {
    return null;
  }
}

// ── Component ────────────────────────────────────────────────────────────

export function AISidebar({
  open,
  elements,
  excalidrawAPI,
  onClose,
}: AISidebarProps) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open && !sessionId && !loading) {
      setLoading(true);
      api.sessions
        .create({ title: "画板协作" })
        .then((s) => {
          setSessionId(s.id);
          setMessages([{ role: "system", text: "AI 助手已就绪。可以让我帮你画图、修改元素、调整布局。" }]);
        })
        .catch(() => {
          setMessages([{ role: "system", text: "无法连接到 AI 服务，请确认 aibase 已启动。" }]);
        })
        .finally(() => setLoading(false));
    }
  }, [open, sessionId, loading]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 300);
  }, [open]);

  const buildPrompt = useCallback(
    (userText: string): string => {
      const summary = elements.length > 0
        ? elements.map((el) => {
            const label = el.text ? `"${el.text.slice(0, 60)}"` : el.type;
            return `- ${label} (${el.type}) at (${el.x}, ${el.y}) ${el.width}x${el.height}`;
          }).join("\n")
        : "（画布为空）";
      return `当前画布有 ${elements.length} 个元素：\n${summary}\n\n用户指令：${userText}\n\n请用中文回答。`;
    },
    [elements],
  );

  const sendPrompt = useCallback(async () => {
    const text = input.trim();
    if (!text || !sessionId || streaming) return;

    setInput("");
    setStreaming(true);
    setMessages((prev) => [...prev, { role: "user", text }]);
    setMessages((prev) => [...prev, { role: "assistant", text: "" }]);

    let aiText = "";
    let doneReceived = false;

    try {
      await api.sessions.promptStream(
        sessionId,
        { text: buildPrompt(text) },
        (event, data) => {
          const d = data as SseData;
          switch (event) {
            case "assistant": {
              aiText = d.text ?? "";
              setMessages((prev) => {
                const copy = [...prev];
                const last = copy[copy.length - 1];
                if (last?.role === "assistant") {
                  copy[copy.length - 1] = { ...last, text: aiText };
                } else {
                  copy.push({ role: "assistant", text: aiText });
                }
                return copy;
              });
              break;
            }
            case "done":
              doneReceived = true;
              break;
            case "messages":
              if (d.messages && Array.isArray(d.messages)) {
                const lastMsg = d.messages[d.messages.length - 1];
                if (lastMsg?.role === "assistant" && lastMsg?.content && lastMsg.content.length > aiText.length) {
                  aiText = lastMsg.content;
                  setMessages((prev) => {
                    const copy = [...prev];
                    const last = copy[copy.length - 1];
                    if (last?.role === "assistant") {
                      copy[copy.length - 1] = { ...last, text: aiText };
                    } else {
                      copy.push({ role: "assistant", text: aiText });
                    }
                    return copy;
                  });
                }
              }
              break;
            case "permission":
              api.sessions.respondPermission(sessionId, d.id ?? "", true);
              break;
            case "error":
              setMessages((prev) => {
                const copy = [...prev];
                const last = copy[copy.length - 1];
                if (last?.role === "assistant" && !last.text) copy.pop();
                copy.push({ role: "system", text: `错误: ${d.message ?? "未知错误"}` });
                return copy;
              });
              break;
          }
        },
      );

      if (doneReceived && aiText && excalidrawAPI) {
        // Strategy 1: try JSON from AI
        const shapesFromJson = tryParseDrawingJson(aiText);
        if (shapesFromJson && shapesFromJson.length > 0) {
          drawShapes(excalidrawAPI, shapesFromJson);
        } else {
          // Strategy 2: auto-generate from text
          const shouldDraw = /画|draw|架构|生成|展示|diagram|chart|flow/.test(text.toLowerCase());
          if (shouldDraw) {
            const shapes = generateShapesFromText(aiText, elements.length);
            if (shapes.length > 0) {
              drawShapes(excalidrawAPI, shapes);
            }
          }
        }
      }
    } catch (err) {
      setMessages((prev) => {
        const copy = [...prev];
        const last = copy[copy.length - 1];
        if (last?.role === "assistant" && !last.text) copy.pop();
        copy.push({ role: "system", text: `请求失败: ${err instanceof Error ? err.message : String(err)}` });
        return copy;
      });
    } finally {
      setStreaming(false);
    }
  }, [input, sessionId, streaming, buildPrompt, excalidrawAPI, elements.length]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendPrompt();
      }
    },
    [sendPrompt],
  );

  return (
    <div className={`ai-sidebar ${open ? "open" : ""}`}>
      <div className="sidebar-header">
        <h3>AI 助手</h3>
        <button className="close-btn" onClick={onClose} aria-label="关闭">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      <div className="messages">
        {loading && <div className="msg system loading">正在连接 AI 服务…</div>}
        {!loading && messages.map((msg, i) => (
          <div key={i} className={`msg ${msg.role}`}>{msg.text}</div>
        ))}
        {streaming && (
          <div className="msg assistant streaming-indicator">
            <span className="dot" /><span className="dot" /><span className="dot" />
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="input-area">
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={sessionId ? "输入指令…（Enter 发送）" : "等待连接…"}
          disabled={streaming || !sessionId}
          rows={2}
        />
        <button className="send-btn" onClick={sendPrompt} disabled={streaming || !input.trim() || !sessionId}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
        </button>
      </div>
    </div>
  );
}
