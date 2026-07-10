interface FloatingAIButtonProps {
  open: boolean;
  onToggle: () => void;
}

export function FloatingAIButton({ open, onToggle }: FloatingAIButtonProps) {
  return (
    <button
      onClick={onToggle}
      className={`floating-ai-btn ${open ? "active" : ""}`}
      aria-label={open ? "Close AI sidebar" : "Open AI sidebar"}
      title={open ? "收起 AI 助手" : "打开 AI 助手"}
    >
      <svg
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2z" />
        <path d="M8 9.05a2.5 2.5 0 0 1 2-1.05 2.5 2.5 0 0 1 2 1.05" />
        <line x1="8" y1="13" x2="8.01" y2="13" />
        <line x1="12" y1="13" x2="12.01" y2="13" />
        <line x1="16" y1="13" x2="16.01" y2="13" />
        <line x1="8" y1="17" x2="16" y2="17" />
      </svg>
      {!open && <span className="btn-label">AI</span>}
    </button>
  );
}
