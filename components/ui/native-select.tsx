import * as React from "react"
import { cn } from "@/lib/utils"

/** A real <select> that matches the shadcn Input. Used where native behavior matters (filters, keyboard type-ahead, assistive tech). */
function NativeSelect({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      data-slot="native-select"
      className={cn(
        "h-11 w-full min-w-0 appearance-none rounded-md border border-input bg-transparent bg-[length:16px] bg-[position:right_12px_center] bg-no-repeat px-3 pr-9 text-sm outline-none transition-[color,box-shadow] md:h-10 dark:bg-input/30",
        "bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2216%22 height=%2216%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%23a1a6b0%22 stroke-width=%222%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22><path d=%22m6 9 6 6 6-6%22/></svg>')]",
        "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
}

export { NativeSelect }
