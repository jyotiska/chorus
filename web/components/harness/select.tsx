"use client";

import type { ReactNode } from "react";
import { HarnessSelectContext, type HarnessSelectProps } from "@/lib/api/chorus/harness-workspace";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";

export function HarnessSelect({ label, value, options, onValueChange, placeholder, container }: HarnessSelectProps) {
  const groups = new Set(options.map((option) => option.group));

  return (
    <Select value={value} items={options} onValueChange={(next) => {
      if (next !== null) onValueChange(next);
    }}>
      <SelectTrigger aria-label={label} size="sm">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent container={container} align="start" alignItemWithTrigger={false} className="max-w-(--available-width)">
        {[...groups].map((group) => {
          const items = options.filter((item) => item.group === group).map((item) => (
            <SelectItem key={item.value} value={item.value}
              className="text-xs [&>span:first-child]:min-w-0 [&>span:first-child]:shrink [&>span:first-child]:whitespace-normal [&>span:first-child]:wrap-anywhere">
              {item.label}
            </SelectItem>
          ));
          return group ? (
            <SelectGroup key={group}>
              <SelectLabel>{group}</SelectLabel>
              {items}
            </SelectGroup>
          ) : items;
        })}
      </SelectContent>
    </Select>
  );
}

const renderHarnessSelect = (props: HarnessSelectProps) => <HarnessSelect {...props} />;

export function HarnessSelectProvider({ children }: { children: ReactNode }) {
  return <HarnessSelectContext.Provider value={renderHarnessSelect}>{children}</HarnessSelectContext.Provider>;
}
