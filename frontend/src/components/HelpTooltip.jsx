import { useState } from 'react';
import { HelpCircle } from 'lucide-react';

export default function HelpTooltip({ text }) {
  const [open, setOpen] = useState(false);
  return (
    <span style={{ position: 'relative', display: 'inline-block', marginLeft: 6 }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        onBlur={() => setOpen(false)}
        style={{
          background: 'transparent', border: 'none', cursor: 'pointer',
          color: '#64748b', padding: 0, display: 'inline-flex', alignItems: 'center',
        }}
        aria-label="Help"
      >
        <HelpCircle size={14} />
      </button>
      {open && (
        <div
          style={{
            position: 'absolute', top: '120%', left: 0, zIndex: 10,
            background: '#1e293b', color: '#e2e8f0', fontSize: 12, lineHeight: 1.5,
            padding: '10px 12px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.08)',
            width: 280, boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
          }}
        >
          {text}
        </div>
      )}
    </span>
  );
}
