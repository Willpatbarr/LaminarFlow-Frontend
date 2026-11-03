import { describe, expect, it } from "vitest";

import type { ActivityEntry } from "@/sync";

import { describeGroup, type Names } from "./describe";
import { groupActivity } from "./group";

const names: Names = {
  me: "me",
  person: (id) => ({ riley: "Riley", me: "Will" })[id],
  status: () => undefined,
  epic: () => undefined,
  label: () => undefined,
  milestone: () => undefined,
  aspectType: () => undefined,
};

const at = (minute: number) =>
  new Date(Date.UTC(2026, 0, 1, 12, 0, 0) + minute * 60_000).toISOString();

const edit = (id: string, minute: number, actor = "me"): ActivityEntry => ({
  id,
  entity_type: "ticket",
  entity_id: "t",
  actor_id: actor,
  kind: "field_changed",
  field: "description",
  summary_before: null,
  summary_after: null,
  name_before: null,
  name_after: null,
  created_at: at(minute),
});
const other = (id: string, minute: number): ActivityEntry => ({
  ...edit(id, minute),
  kind: "archived",
  field: null,
});

const ids = (list: ActivityEntry[]) => groupActivity(list).map((g) => g.members.map((m) => m.id));

describe("groupActivity", () => {
  it("groups the same actor's edits within the window and shows the latest", () => {
    const groups = groupActivity([edit("d", 3), edit("c", 2), edit("b", 1), edit("a", 0)]);
    expect(groups).toHaveLength(1);
    expect(groups[0].entry.id).toBe("d");
    expect(groups[0].entry.created_at).toBe(at(3));
    expect(describeGroup(groups[0], names)).toBe("You edited the description (4×)");
  });

  it("chains: each edit only needs to be within 10 minutes of its neighbour", () => {
    expect(ids([edit("c", 20), edit("b", 10), edit("a", 0)])).toEqual([["c", "b", "a"]]);
  });

  it("splits on a gap over 10 minutes", () => {
    expect(ids([edit("c", 21), edit("b", 10), edit("a", 9)])).toEqual([["c"], ["b", "a"]]);
    expect(ids([edit("b", 10), edit("a", 0)])).toEqual([["b", "a"]]);
    expect(ids([edit("b", 10.01), edit("a", 0)])).toEqual([["b"], ["a"]]);
  });

  it("does not group across a different actor or another kind of entry", () => {
    expect(ids([edit("c", 2), edit("b", 1, "riley"), edit("a", 0)])).toEqual([["c"], ["b"], ["a"]]);
    expect(ids([edit("c", 2), other("b", 1), edit("a", 0)])).toEqual([["c"], ["b"], ["a"]]);
  });

  it("names another person, and leaves a single edit as it was", () => {
    const [group] = groupActivity([edit("b", 1, "riley"), edit("a", 0, "riley")]);
    expect(describeGroup(group, names)).toBe("Riley edited the description (2×)");
    const [single] = groupActivity([edit("a", 0)]);
    expect(describeGroup(single, names)).toBe("You changed the description");
  });

  it("never groups entries with no actor", () => {
    expect(ids([edit("b", 1, "x"), edit("a", 0, "x")].map((e) => ({ ...e, actor_id: null })))).toEqual([["b"], ["a"]]);
  });

  it("a live entry joins the open group when the list is regrouped", () => {
    const held = [edit("b", 1), edit("a", 0)];
    expect(ids([edit("c", 5), ...held])).toEqual([["c", "b", "a"]]);
    expect(ids([other("z", 6), edit("c", 5), ...held])).toEqual([["z"], ["c", "b", "a"]]);
  });
});
