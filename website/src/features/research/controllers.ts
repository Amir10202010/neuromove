// One live device controller per validation session, shared by every mount of its page.
// Reference-counted: an effect retains it, its cleanup releases it, and the controller is disposed only
// when no mount holds it after the current task. This survives React StrictMode's mount → unmount →
// mount in development without disposing the device under the user's feet.

import { SessionController } from '../../state/sessionController';

const live = new Map<string, { c: SessionController; refs: number; timer: ReturnType<typeof setTimeout> | null }>();

/** Existing controller for this session, or a new one (render-safe: creation is idempotent per id). */
export function controllerFor(id: string, make: () => SessionController): SessionController {
  let e = live.get(id);
  if (!e) {
    e = { c: make(), refs: 0, timer: null };
    live.set(id, e);
  }
  return e.c;
}

export function retain(id: string): void {
  const e = live.get(id);
  if (!e) return;
  if (e.timer) clearTimeout(e.timer);
  e.timer = null;
  e.refs += 1;
}

export function release(id: string): void {
  const e = live.get(id);
  if (!e) return;
  e.refs -= 1;
  if (e.refs > 0) return;
  e.timer = setTimeout(() => {
    if (e.refs > 0) return;
    live.delete(id);
    void e.c.dispose();
  }, 0);
}
