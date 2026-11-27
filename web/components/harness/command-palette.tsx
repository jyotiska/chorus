"use client";

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { Search } from "lucide-react";

export type Command = {
  id: string;
  label: string;
  group: string;
  icon?: ReactNode;
  hint?: string;
  keys?: string[];
  danger?: boolean;
  disabled?: boolean;
  run: () => void;
};

export function Kbd({ keys }: { keys: string[] }) {
  return (
    <span className="kbd-hint" aria-hidden="true">
      {keys.map((key) => <kbd key={key}>{key}</kbd>)}
    </span>
  );
}

export const modKey = () =>
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl";

/** Cmd+K palette: filter, arrow keys to move, Enter to run, Esc to close. */
export function CommandPalette({ commands, close }: { commands: Command[]; close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const listId = useId();
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const needle = query.trim().toLowerCase();
  const groups = useMemo(() => {
    const visible = commands.filter((command) =>
      !command.disabled && (!needle || `${command.label} ${command.hint ?? ""} ${command.group}`.toLowerCase().includes(needle)));
    const order: string[] = [];
    for (const command of visible) if (!order.includes(command.group)) order.push(command.group);
    return order.map((group) => ({ group, items: visible.filter((command) => command.group === group) }));
  }, [commands, needle]);
  const flat = groups.flatMap((group) => group.items);
  const active = Math.min(index, Math.max(0, flat.length - 1));

  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  useEffect(() => {
    list.current?.querySelector<HTMLElement>("[aria-selected=true]")?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const choose = (command?: Command) => {
    if (!command) return;
    close();
    // Run after the palette unmounts so focus can move to the target.
    requestAnimationFrame(() => command.run());
  };

  return (
    <dialog
      ref={dialog}
      className="command-palette"
      aria-label="Command palette"
      onClose={close}
      onClick={(event) => {
        if (event.target === dialog.current) dialog.current.close();
      }}
    >
      <div className="command-search">
        <Search aria-hidden="true" />
        <input
          autoFocus
          value={query}
          placeholder="Search runs, views and actions"
          aria-label="Command"
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={flat[active] ? `${listId}-${flat[active].id}` : undefined}
          onChange={(event) => {
            setQuery(event.target.value);
            setIndex(0);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setIndex(Math.min(flat.length - 1, active + 1));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setIndex(Math.max(0, active - 1));
            } else if (event.key === "Enter") {
              event.preventDefault();
              choose(flat[active]);
            }
          }}
        />
        <Kbd keys={["esc"]} />
      </div>
      <div className="command-list" id={listId} role="listbox" ref={list} aria-label="Commands">
        {groups.length ? groups.map(({ group, items }) => (
          <div key={group} role="group" aria-label={group}>
            <div className="command-group" aria-hidden="true">{group}</div>
            {items.map((command) => {
              const mine = flat.indexOf(command);
              return (
                <div
                  key={command.id}
                  id={`${listId}-${command.id}`}
                  role="option"
                  aria-selected={mine === active}
                  className={command.danger ? "command-item danger" : "command-item"}
                  onMouseMove={() => mine !== active && setIndex(mine)}
                  onClick={() => choose(command)}
                >
                  {command.icon}
                  <span className="command-label">{command.label}</span>
                  {command.hint && <span className="command-hint">{command.hint}</span>}
                  {command.keys && <Kbd keys={command.keys} />}
                </div>
              );
            })}
          </div>
        )) : (
          <p className="command-empty">No matches for “{query}”. Try a run title, a view or an action.</p>
        )}
      </div>
      <div className="command-foot" aria-hidden="true">
        <span><Kbd keys={["↑", "↓"]} /> move</span>
        <span><Kbd keys={["↵"]} /> run</span>
        <span><Kbd keys={["esc"]} /> close</span>
      </div>
    </dialog>
  );
}
