import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { commonEmoji } from "../lib/extendedMarks";

interface EmojiPickerProps {
  onOpen: () => void;
  onInsert: (emoji: string) => void;
}

export function EmojiPicker({ onOpen, onInsert }: EmojiPickerProps) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 8, top: 8 });
  const root = useRef<HTMLSpanElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!root.current?.contains(target) && !panel.current?.contains(target)) setOpen(false);
    };
    const closeFromEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", closeOutside, true);
    window.addEventListener("keydown", closeFromEscape);
    return () => {
      window.removeEventListener("pointerdown", closeOutside, true);
      window.removeEventListener("keydown", closeFromEscape);
    };
  }, [open]);

  return (
    <span className="emoji-picker" ref={root}>
      <button
        ref={trigger}
        aria-expanded={open}
        aria-haspopup="dialog"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          if (!open) {
            onOpen();
            const bounds = trigger.current?.getBoundingClientRect();
            if (bounds) setPosition({
              left: Math.max(8, Math.min(bounds.left, window.innerWidth - 183)),
              top: bounds.bottom + 7,
            });
          }
          setOpen((value) => !value);
        }}
      >Emoji</button>
      {open && createPortal(
        <span ref={panel} className="emoji-grid" role="grid" aria-label="Emoji 选择" style={position}>
          {commonEmoji.map((emoji) => (
            <button
              key={emoji}
              aria-label={`插入 ${emoji}`}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                onInsert(emoji);
                setOpen(false);
              }}
            >{emoji}</button>
          ))}
        </span>,
        document.body,
      )}
    </span>
  );
}
