import type { ActivityEntry } from "@/sync";

/*
┌─ activity ──────────────────────────────────────
│  display grouping of repeated description edits (LAM-224)
├─ out ───────────────────────────────────────────
│      ActivityGroup              one displayed line: the latest entry and all it stands for
│      GROUP_WINDOW_MS            10 minutes
│      groupActivity(entries)     newest-first entries in, newest-first groups out
*/
// Display only: the server still holds one entry per autosave. Consecutive means
// adjacent in the displayed order (nothing else between them), same actor, and each
// one within the window of the next older one. A group shows its latest entry (so
// its latest time); `members` is every entry in it, newest first. Run on the whole
// merged list, so a live `activity.created` joins an open group by being regrouped.
// An entry without an actor (a deleted account) is never grouped: it may not be one person.

export const GROUP_WINDOW_MS = 10 * 60 * 1000;

export type ActivityGroup = {
  /** The newest entry: its id, time and wording stand for the group. */
  entry: ActivityEntry;
  /** Every entry the line stands for, newest first (one when not grouped). */
  members: ActivityEntry[];
};

const isDescriptionEdit = (e: ActivityEntry) =>
  e.kind === "field_changed" && e.field === "description";

export function groupActivity(entries: ActivityEntry[]): ActivityGroup[] {
  const groups: ActivityGroup[] = [];
  for (const entry of entries) {
    const open = groups.at(-1);
    const previous = open?.members.at(-1);
    if (
      open &&
      previous &&
      isDescriptionEdit(entry) &&
      isDescriptionEdit(previous) &&
      entry.actor_id !== null &&
      entry.actor_id === previous.actor_id &&
      entry.entity_type === previous.entity_type &&
      entry.entity_id === previous.entity_id &&
      Math.abs(Date.parse(previous.created_at) - Date.parse(entry.created_at)) <=
        GROUP_WINDOW_MS
    ) {
      open.members.push(entry);
    } else {
      groups.push({ entry, members: [entry] });
    }
  }
  return groups;
}
