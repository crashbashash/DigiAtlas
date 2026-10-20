import { useEffect, useRef, useState } from 'preact/hooks';
import { routes, type MapSelection } from '../../app/route';
import { Link } from '../common';
import { useApp } from '../context';

/**
 * Worlds and their rooms. The current room's world is open and the others fold away so the list
 * stays short. Keyboard: Up/Down move, Right opens a world, Left closes it or goes up to it.
 */
export function WorldTree({ currentId, keep }: { currentId: string; keep: MapSelection }) {
  const { model, settings } = useApp();
  const currentWorld = model.worlds.find((w) =>
    w.rooms.some((r) => r.stages.some((s) => s.id === currentId)),
  )?.area;
  const [open, setOpen] = useState<Set<string>>(() => new Set(currentWorld ? [currentWorld] : []));
  const tree = useRef<HTMLUListElement>(null);

  // Moving to another world opens it and folds the rest.
  useEffect(() => {
    if (currentWorld) setOpen(new Set([currentWorld]));
  }, [currentWorld]);
  useEffect(() => {
    tree.current?.querySelector('.room.active')?.scrollIntoView({ block: 'nearest' });
  }, [currentId]);

  const toggle = (area: string, value?: boolean) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (value ?? !next.has(area)) next.add(area);
      else next.delete(area);
      return next;
    });

  const onKey = (e: KeyboardEvent) => {
    const items = Array.from(tree.current?.querySelectorAll<HTMLElement>('[data-tree-item]') ?? []);
    const at = items.indexOf(document.activeElement as HTMLElement);
    if (at < 0) return;
    const el = items[at];
    const world = el.dataset.world!;
    const isWorld = el.dataset.treeItem === 'world';
    let next: HTMLElement | undefined;
    if (e.key === 'ArrowDown') next = items[at + 1];
    else if (e.key === 'ArrowUp') next = items[at - 1];
    else if (e.key === 'ArrowRight' && isWorld) {
      if (!open.has(world)) toggle(world, true);
      else next = items[at + 1];
    } else if (e.key === 'ArrowLeft') {
      if (isWorld) toggle(world, false);
      else next = items.find((x) => x.dataset.treeItem === 'world' && x.dataset.world === world);
    } else return;
    e.preventDefault();
    next?.focus();
  };

  // One tab stop: the current room, or the first world.
  let stop = false;
  const tabIndex = (active: boolean) => {
    if (active && !stop) {
      stop = true;
      return 0;
    }
    return -1;
  };
  const hasActive = model.worlds.some(
    (w) => open.has(w.area) && w.rooms.some((r) => r.stages.some((s) => s.id === currentId)),
  );

  return (
    <ul class="tree" role="tree" aria-label="Worlds and rooms" ref={tree} onKeyDown={onKey}>
      {model.worlds.map((w, wi) => {
        const isOpen = open.has(w.area);
        return (
          <li role="treeitem" aria-expanded={isOpen} aria-label={w.area} class="world-item">
            <button
              type="button"
              class={`world${isOpen ? ' open' : ''}`}
              data-tree-item="world"
              data-world={w.area}
              tabIndex={tabIndex(!hasActive && wi === 0)}
              onClick={() => toggle(w.area)}
            >
              <span>{w.area}</span>
              <span class="muted">{w.rooms.length}</span>
            </button>
            {isOpen && (
              <ul role="group">
                {w.rooms.map((r) => {
                  const active = r.stages.some((s) => s.id === currentId);
                  const target = active
                    ? currentId
                    : model.stageOn(r.stages[0], settings.difficulty).id;
                  const floors = r.stages.filter(
                    (s) => model.stageOn(s, settings.difficulty).id === s.id,
                  );
                  return (
                    <li
                      role="treeitem"
                      aria-selected={active}
                      class={`room${active ? ' active' : ''}`}
                    >
                      <Link
                        to={routes.map(target, keep)}
                        class="name"
                        data-tree-item="room"
                        data-world={w.area}
                        tabIndex={tabIndex(active)}
                      >
                        {r.room}
                      </Link>
                      {active && floors.length > 1 && (
                        <div class="floors" role="group" aria-label={`${r.room} maps`}>
                          {floors.map((s) => (
                            <Link
                              to={routes.map(s.id, keep)}
                              class={`chip${s.id === currentId ? ' on' : ''}`}
                              data-tree-item="room"
                              data-world={w.area}
                              tabIndex={-1}
                              aria-current={s.id === currentId ? 'page' : undefined}
                            >
                              {model.chipLabel(r, s)}
                            </Link>
                          ))}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );
}
