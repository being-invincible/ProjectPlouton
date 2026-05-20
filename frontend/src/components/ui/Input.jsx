import * as React from "react";
import { cn } from "@/lib/utils";

function Input({ className, type, ...props }) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-9 w-full min-w-0 rounded-lg border border-input bg-input/30 px-3 py-1 text-sm text-foreground transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50",
        className
      )}
      {...props}
    />
  );
}

function Select({ className, children, ...props }) {
  return (
    <select
      data-slot="select"
      className={cn(
        "h-9 w-full min-w-0 rounded-lg border border-input bg-input/30 px-3 py-1 text-sm text-foreground transition-colors outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 cursor-pointer",
        className
      )}
      {...props}
    >
      {children}
    </select>
  );
}

function InputField({ label, hint, accentColor, children, className, ...props }) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)} {...props}>
      <label
        style={{
          fontSize: '11px',
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          color: accentColor ? accentColor + 'cc' : '#64748b',
        }}
      >
        {label}
      </label>
      {children}
      {hint && (
        <p style={{ fontSize: '11px', color: '#475569', lineHeight: 1.4 }}>{hint}</p>
      )}
    </div>
  );
}

export { Input, Select, InputField };
