import { describe as suite, expect, it } from "vitest";

import type { ActivityEntry } from "@/sync";

import { describe, type Names } from "./describe";

const names: Names = {
  me: "me",
  person: (id) => ({ ann: "Ann", me: "Will" })[id],
  status: (id) => ({ s1: "To do", s2: "In Progress" })[id],
  epic: (id) => ({ e1: "Launch" })[id],
  label: (id) => ({ l1: "bug" })[id],
  milestone: (id) => ({ m1: "Beta" })[id],
  aspectType: (id) => ({ a1: "Spec" })[id],
};

const entry = (overrides: Partial<ActivityEntry>): ActivityEntry => ({
  id: "x",
  entity_type: "ticket",
  entity_id: "t",
  actor_id: "ann",
  kind: "created",
  field: null,
  summary_before: null,
  summary_after: null,
  name_before: null,
  name_after: null,
  created_at: "2026-01-01T00:00:00Z",
  ...overrides,
});

suite("describe", () => {
  it("names the actor, says You for the viewer, and Someone for a deleted account", () => {
    expect(describe(entry({}), names)).toBe("Ann created this ticket");
    expect(describe(entry({ actor_id: "me" }), names)).toBe(
      "You created this ticket",
    );
    expect(describe(entry({ actor_id: null }), names)).toBe(
      "Someone created this ticket",
    );
    expect(describe(entry({ actor_id: "stranger" }), names)).toBe(
      "Someone created this ticket",
    );
  });

  it("resolves ids to names", () => {
    expect(
      describe(
        entry({
          kind: "status_changed",
          summary_before: "s1",
          summary_after: "s2",
        }),
        names,
      ),
    ).toBe("Ann moved this from To do to In Progress");
    expect(
      describe(
        entry({ kind: "assignee_changed", summary_after: "ann" }),
        names,
      ),
    ).toBe("Ann assigned this to Ann");
    expect(
      describe(
        entry({ kind: "assignee_changed", summary_before: "ann" }),
        names,
      ),
    ).toBe("Ann removed the assignee");
    expect(
      describe(entry({ kind: "parent_changed", summary_after: "e1" }), names),
    ).toBe("Ann put this under the epic Launch");
    expect(
      describe(entry({ kind: "label_added", summary_after: "l1" }), names),
    ).toBe("Ann added the label bug");
    expect(
      describe(entry({ kind: "label_removed", summary_before: "l1" }), names),
    ).toBe("Ann removed the label bug");
    expect(
      describe(
        entry({
          kind: "field_changed",
          field: "milestone",
          summary_after: "m1",
        }),
        names,
      ),
    ).toBe("Ann set the milestone to Beta");
  });

  it("says a status by the name stored with the entry, even when it was renamed or deleted", () => {
    // s1 is now called "To do", s2 "In Progress"; the entry remembers what they were called then.
    const moved = {
      kind: "status_changed",
      summary_before: "s1",
      summary_after: "s2",
      name_before: "Backlog",
      name_after: "Doing",
    } as const;
    expect(describe(entry(moved), names)).toBe(
      "Ann moved this from Backlog to Doing",
    );
    expect(
      describe(
        entry({ ...moved, summary_before: "gone", summary_after: "gone2" }),
        names,
      ),
    ).toBe("Ann moved this from Backlog to Doing");
  });

  it('falls back to the live status name, then to "a deleted status"', () => {
    const old = {
      kind: "status_changed",
      summary_before: "s1",
      summary_after: "s2",
    } as const;
    expect(describe(entry(old), names)).toBe(
      "Ann moved this from To do to In Progress",
    );
    expect(describe(entry({ ...old, summary_before: "gone" }), names)).toBe(
      "Ann moved this from a deleted status to In Progress",
    );
    // An entry synced before the field existed has no name keys at all.
    const bare = entry(old) as Partial<ActivityEntry>;
    delete bare.name_before;
    expect(describe(bare as ActivityEntry, names)).toBe(
      "Ann moved this from To do to In Progress",
    );
  });

  it("does not guess at an id nobody holds any more", () => {
    expect(
      describe(entry({ kind: "status_changed", summary_after: "gone" }), names),
    ).toBe("Ann set the status to a deleted status");
    expect(
      describe(entry({ kind: "label_added", summary_after: "gone" }), names),
    ).toBe("Ann added the label one that was removed");
  });

  it("words text and document changes", () => {
    expect(
      describe(
        entry({ kind: "field_changed", field: "title", summary_after: "New" }),
        names,
      ),
    ).toBe('Ann changed the title to "New"');
    expect(
      describe(entry({ kind: "field_changed", field: "description" }), names),
    ).toBe("Ann changed the description");
    const doc = { entity_type: "document" as const };
    expect(describe(entry({ ...doc, kind: "archived" }), names)).toBe(
      "Ann archived this document",
    );
    expect(
      describe(
        entry({ ...doc, kind: "aspect_type_changed", summary_after: "a1" }),
        names,
      ),
    ).toBe("Ann made this an Aspect (Spec)");
    expect(
      describe(
        entry({ ...doc, kind: "aspect_type_changed", summary_before: "a1" }),
        names,
      ),
    ).toBe("Ann made this a normal document");
  });
});
