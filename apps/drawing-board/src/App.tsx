import { useState, useCallback, useMemo } from "react";
import { Excalidraw } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { FloatingAIButton } from "./components/FloatingAIButton";
import { AISidebar } from "./components/AISidebar";

interface ElementSummary {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  text: string | null;
}

export default function App() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [excalidrawAPI, setExcalidrawAPI] =
    useState<ExcalidrawImperativeAPI | null>(null);

  const handleChange = useCallback(() => {
  }, []);

  const elementsSummary: ElementSummary[] = useMemo(() => {
    if (!excalidrawAPI) return [];
    const elements = excalidrawAPI.getSceneElements();
    return elements.map((el) => ({
      id: el.id,
      type: el.type,
      x: Math.round(el.x),
      y: Math.round(el.y),
      width: "width" in el ? Math.round(el.width) : 0,
      height: "height" in el ? Math.round(el.height) : 0,
      text: "text" in el && el.text ? String(el.text) : null,
    }));
  }, [excalidrawAPI, sidebarOpen]);

  return (
    <div
      style={{
        width: "100vw",
        height: "100vh",
        position: "relative",
        overflow: "hidden",
      }}
    >
      <Excalidraw
        excalidrawAPI={(api) => setExcalidrawAPI(api)}
        onChange={handleChange}
      />

      <FloatingAIButton
        open={sidebarOpen}
        onToggle={() => setSidebarOpen((v) => !v)}
      />

      <AISidebar
        open={sidebarOpen}
        elements={elementsSummary}
        excalidrawAPI={excalidrawAPI}
        onClose={() => setSidebarOpen(false)}
      />
    </div>
  );
}
