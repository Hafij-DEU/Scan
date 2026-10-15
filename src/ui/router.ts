export interface Screen {
  /** Stable name, e.g. "home" or "doc:<id>", used by popTo. */
  name: string;
  el: HTMLElement;
  /** Another screen was pushed on top. */
  pause?(): void;
  /** This screen is on top again. */
  resume?(): void;
  /** Removed from the stack. */
  dispose?(): void;
}

const stack: Screen[] = [];
let root: HTMLElement;

export function initRouter(el: HTMLElement, first: Screen): void {
  root = el;
  push(first);
}

export function push(screen: Screen): void {
  const top = stack[stack.length - 1];
  if (top) {
    top.el.hidden = true;
    top.pause?.();
  }
  stack.push(screen);
  screen.el.classList.add('screen');
  root.append(screen.el);
}

/** Replaces the top screen without resuming the one below. */
export function replace(screen: Screen): void {
  const top = stack.pop();
  if (top) {
    top.dispose?.();
    top.el.remove();
  }
  stack.push(screen);
  screen.el.classList.add('screen');
  root.append(screen.el);
}

export function canPop(): boolean {
  return stack.length > 1;
}

export function pop(): boolean {
  if (stack.length <= 1) return false;
  const top = stack.pop()!;
  top.dispose?.();
  top.el.remove();
  const next = stack[stack.length - 1];
  next.el.hidden = false;
  next.resume?.();
  return true;
}

/** Pops until the named screen is on top; returns false (and changes nothing) if it is not in the stack. */
export function popTo(name: string): boolean {
  const i = stack.findIndex((s) => s.name === name);
  if (i < 0) return false;
  while (stack.length > i + 1) {
    const top = stack.pop()!;
    top.dispose?.();
    top.el.remove();
  }
  const next = stack[i];
  next.el.hidden = false;
  next.resume?.();
  return true;
}
