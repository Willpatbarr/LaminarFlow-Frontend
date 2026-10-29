import type { components } from '@/api/schema'

/*
┌─ sync ──────────────────────────────────────────
│  activity.created events off the change feed (LAM-114)
├─ out ───────────────────────────────────────────
│      ActivityEntry                    the server's ActivityBody
│      onActivityEvent(fn) → off        hear every entry announced anywhere
│      publishActivityFrame(frame)      for the socket: reads a frame, tells the listeners
*/
// Activity is read-only history, not a row: it never goes through the engine or
// the local database. The screens that show a history listen here and put the
// entry at the top of what they hold (skipping one they already have).

export type ActivityEntry = components['schemas']['ActivityBody']

const listeners = new Set<(entry: ActivityEntry) => void>()

export function onActivityEvent(fn: (entry: ActivityEntry) => void): () => void {
    listeners.add(fn)
    return () => {
        listeners.delete(fn)
    }
}

/** Reads one change-feed frame; does nothing for any other kind. Never throws. */
export function publishActivityFrame(frame: unknown): void {
    if (typeof frame !== 'object' || frame === null) return
    const { type, activity } = frame as Record<string, unknown>
    if (type !== 'activity.created' || typeof activity !== 'object' || activity === null) return
    const entry = activity as Partial<ActivityEntry>
    if (typeof entry.id !== 'string' || typeof entry.entity_id !== 'string' || typeof entry.kind !== 'string') return
    if (typeof entry.created_at !== 'string') return
    for (const fn of [...listeners]) {
        try {
            fn(entry as ActivityEntry)
        } catch (error) {
            console.error('an activity listener failed', error)
        }
    }
}
