import * as React from "react";
import { cn } from "@/lib/utils";

function Card({ className, size = "default", hover, ...props }) {
  return (
    <div
      data-slot="card"
      data-size={size}
      className={cn(
        "group/card flex flex-col gap-4 overflow-hidden rounded-xl bg-card py-4 text-sm text-card-foreground ring-1 ring-foreground/10 has-data-[slot=card-footer]:pb-0 data-[size=sm]:gap-3 data-[size=sm]:py-3",
        className
      )}
      {...props}
    />
  );
}

function CardHeader({ className, ...props }) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        "grid auto-rows-min items-start gap-1 rounded-t-xl px-4 has-data-[slot=card-action]:grid-cols-[1fr_auto] has-data-[slot=card-description]:grid-rows-[auto_auto] [.border-b]:pb-4",
        className
      )}
      {...props}
    />
  );
}

function CardTitle({ className, icon: Icon, iconColor, children, ...props }) {
  return (
    <div
      data-slot="card-title"
      className={cn("font-semibold text-base leading-snug flex items-center gap-2", className)}
      {...props}
    >
      {Icon && <Icon style={{ width: '16px', height: '16px', color: iconColor, flexShrink: 0 }} />}
      {children}
    </div>
  );
}

function CardDescription({ className, ...props }) {
  return (
    <div
      data-slot="card-description"
      className={cn("text-sm text-muted-foreground mt-0.5", className)}
      {...props}
    />
  );
}

function CardAction({ className, ...props }) {
  return (
    <div
      data-slot="card-action"
      className={cn("col-start-2 row-span-2 row-start-1 self-start justify-self-end", className)}
      {...props}
    />
  );
}

function CardContent({ className, ...props }) {
  return (
    <div
      data-slot="card-content"
      className={cn("px-4", className)}
      {...props}
    />
  );
}

function CardFooter({ className, ...props }) {
  return (
    <div
      data-slot="card-footer"
      className={cn("flex items-center rounded-b-xl border-t bg-muted/50 p-4", className)}
      {...props}
    />
  );
}

function Separator({ className, ...props }) {
  return (
    <hr
      className={cn("border-border", className)}
      {...props}
    />
  );
}

export {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardAction,
  CardDescription,
  CardContent,
  Separator,
};
