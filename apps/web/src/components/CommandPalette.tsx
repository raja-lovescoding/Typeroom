import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { fuzzyFilter } from '../lib/fuzzy.js';

export interface Command {
  id: string;
  label: string;
  group?: string;
  /** Shortcut or current value shown on the right. */
  hint?: string | undefined;
  /** Extra words to match on. */
  keywords?: string;
  /** Marks the currently selected option inside a submenu. */
  active?: boolean;
  run?: () => void;
  /** Opens a nested list (e.g. the theme list) instead of running. */
  children?: () => Command[];
  /** Called while the item is highlighted, e.g. live theme preview. */
  onHighlight?: () => void;
}

interface Props {
  commands: Command[];
  /** Open straight into a submenu, e.g. 'theme' from the footer. */
  initialMenu?: string | undefined;
  onClose: () => void;
}

interface Level { title: string; items: Command[] }

export function CommandPalette({ commands, initialMenu, onClose }: Props) {
  const [stack, setStack] = useState<Level[]>(() => {
    const root: Level = { title: 'Commands', items: commands };
    const start = initialMenu ? commands.find((command) => command.id === initialMenu) : undefined;
    return start?.children ? [root, { title: start.label, items: start.children() }] : [root];
  });
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const level = stack[stack.length - 1]!;
  const visible = useMemo(
    () => fuzzyFilter(level.items, query, (item) => `${item.group ?? ''} ${item.label} ${item.keywords ?? ''}`),
    [level, query],
  );

  // Start on the active option in submenus, so arrowing from the current theme feels natural.
  useEffect(() => {
    const active = query ? -1 : visible.findIndex((item) => item.active);
    setSelected(active >= 0 ? active : 0);
  }, [level, query]);
  useEffect(() => { visible[selected]?.onHighlight?.(); }, [selected, visible]);
  useEffect(() => { inputRef.current?.focus(); }, [stack.length]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${selected}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  const choose = (item: Command | undefined) => {
    if (!item) return;
    if (item.children) {
      setStack((current) => [...current, { title: item.label, items: item.children!() }]);
      setQuery('');
      return;
    }
    item.run?.();
    onClose();
  };

  const back = () => {
    if (stack.length > 1) {
      setStack((current) => current.slice(0, -1));
      setQuery('');
    } else onClose();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || (event.key === 'Tab' && !event.shiftKey)) {
      event.preventDefault();
      setSelected((index) => (visible.length === 0 ? 0 : (index + 1) % visible.length));
    } else if (event.key === 'ArrowUp' || (event.key === 'Tab' && event.shiftKey)) {
      event.preventDefault();
      setSelected((index) => (visible.length === 0 ? 0 : (index - 1 + visible.length) % visible.length));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      choose(visible[selected]);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      back();
    } else if (event.key === 'Backspace' && query === '' && stack.length > 1) {
      event.preventDefault();
      back();
    }
  };

  return <div className="overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="palette" role="dialog" aria-modal="true" aria-label="Command palette">
      <div className="palette-head">
        {stack.length > 1 && <button className="crumb" onClick={back} aria-label="Back">‹ {level.title}</button>}
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder={stack.length > 1 ? `Search ${level.title.toLowerCase()}…` : 'Type a command…'}
          role="combobox"
          aria-expanded="true"
          aria-controls="palette-list"
          aria-activedescendant={visible[selected] ? `cmd-${visible[selected]!.id}` : undefined}
        />
      </div>
      <ul className="palette-list" id="palette-list" role="listbox" ref={listRef}>
        {visible.length === 0 && <li className="palette-empty">No matching commands</li>}
        {visible.map((item, index) => <li
          key={item.id}
          id={`cmd-${item.id}`}
          data-index={index}
          role="option"
          aria-selected={index === selected}
          className={`palette-item ${index === selected ? 'selected' : ''}`}
          onMouseMove={() => setSelected(index)}
          onClick={() => choose(item)}
        >
          <span className="check" aria-hidden>{item.active ? '●' : ''}</span>
          {item.group && <span className="palette-group">{item.group}</span>}
          <span className="palette-label">{item.label}</span>
          {item.hint && <span className="palette-hint">{item.hint}</span>}
          {item.children && <span className="palette-hint" aria-hidden>›</span>}
        </li>)}
      </ul>
      <div className="palette-foot"><span>↑↓ move</span><span>enter select</span><span>esc {stack.length > 1 ? 'back' : 'close'}</span></div>
    </div>
  </div>;
}
