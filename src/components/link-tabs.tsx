"use client";

import { useRouter } from "next/navigation";
import { useTransition, type ReactNode } from "react";
import { SectionHeader } from "@/components/ui/frame";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

/**
 * Tabs whose state lives in the URL — a chart's time window, a list's filter —
 * on Minima's line tabs. The URL stays the source of truth, so a view can be
 * linked, reloaded and gone back to; picking a tab navigates, and the server
 * renders the panel. The panel wraps that content, so assistive tech gets a
 * real tablist that controls a real tabpanel rather than a row of links
 * styled to look like tabs.
 */
export function LinkTabs({
  label,
  items,
  value,
  children,
}: {
  label: string;
  items: readonly { value: string; label: string; href: string }[];
  value: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <Tabs
      value={value}
      onValueChange={(next) => {
        const item = items.find((i) => i.value === next);
        if (item) startTransition(() => router.push(item.href, { scroll: false }));
      }}
      className="gap-3"
    >
      <SectionHeader label={label}>
        <TabsList variant="line" aria-label={label}>
          {items.map((i) => (
            <TabsTrigger key={i.value} value={i.value} className="signal px-2 type-label-xs">
              {i.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </SectionHeader>
      <TabsContent value={value} aria-busy={pending} className={pending ? "opacity-60 transition-opacity" : undefined}>
        {children}
      </TabsContent>
    </Tabs>
  );
}
