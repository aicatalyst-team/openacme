import { Bot } from "lucide-react"
import { DynamicIcon, type IconName } from "lucide-react/dynamic"

import { cn } from "@/app/lib/utils"

// Glyph text sizes are tuned so each variant occupies the same visual
// weight as its icon-size counterpart at the existing call sites.
const SIZES = {
  xs: { icon: "size-2.5", glyph: "text-[10px]" },
  sm: { icon: "size-3", glyph: "text-[11px]" },
  md: { icon: "size-3.5", glyph: "text-[13px]" },
  lg: { icon: "size-4", glyph: "text-[15px]" },
  xl: { icon: "size-5", glyph: "text-[19px]" },
} as const

/**
 * Per-agent visual identity. `avatar` is a free-form glyph (typically
 * an emoji) or `icon:<lucide-name>`; absent (or an unknown icon name)
 * falls back to the generic Bot icon.
 */
export function AgentAvatar({
  avatar,
  size = "sm",
  className,
}: {
  avatar?: string | null
  size?: keyof typeof SIZES
  className?: string
}) {
  const fallback = (
    <Bot className={cn("shrink-0", SIZES[size].icon, className)} aria-hidden />
  )
  if (avatar?.startsWith("icon:")) {
    return (
      <DynamicIcon
        name={avatar.slice("icon:".length) as IconName}
        fallback={() => fallback}
        className={cn("inline-block shrink-0", SIZES[size].icon, className)}
        aria-hidden
      />
    )
  }
  if (avatar) {
    return (
      <span
        className={cn(
          "inline-block shrink-0 leading-none",
          SIZES[size].glyph,
          className
        )}
        aria-hidden
      >
        {avatar}
      </span>
    )
  }
  return fallback
}
