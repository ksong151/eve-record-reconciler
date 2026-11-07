import assert from "node:assert/strict";
import { test } from "node:test";
import { reconcile, type Decision } from "../agent/lib/reconcile.ts";
import { FIXED_TIME, recordsFrom } from "./helpers.ts";

// All people, emails, and phone numbers below are fictional
// (example.com addresses and 555-01xx numbers).
const HEADER = "id,first_name,last_name,email,phone,grad_year,city,notes\n";

function run(a: string, b: string, decisions: Decision[] = []) {
  return reconcile(recordsFrom({ a: HEADER + a, b: HEADER + b }), decisions);
}

const status = (result: ReturnType<typeof run>) =>
  Object.fromEntries(result.pairs.map((p) => [p.id, p.status]));

test("identical name plus shared phone merges automatically", () => {
  const result = run("1,Morgan,Ellis,,312-555-0101,2012,Evanston,\n", "9,Morgan,Ellis,m@example.com,(312) 555-0101,,,\n");
  assert.deepEqual(status(result), { "match:a:2+b:2": "auto" });
  assert.equal(result.members.length, 1);
});

test("a name alone never merges, even with the same graduation year", () => {
  const result = run("1,Avery,Quinn,,,2017,,\n", "9,Avery,Quinn,q@example.com,608-555-0150,2017,,\n");
  const pair = result.pairs[0];
  assert.equal(pair?.status, "review");
  assert.match(pair?.statusReason ?? "", /no shared email or phone/);
  assert.equal(result.members.length, 2);
});

test("a conflicting phone sends an otherwise strong match to review", () => {
  const result = run(
    "1,Rami,Haddad,r@example.com,773-555-0120,2013,,\n",
    "9,Rami,Haddad,r@example.com,773-555-0121,2013,,\n",
  );
  assert.equal(result.pairs[0]?.status, "review");
  assert.match(result.pairs[0]?.statusReason ?? "", /email or phone conflicts/);
});

test("compatible but different first names go to review", () => {
  const result = run("1,Dan,Whitfield,d@example.com,,2009,,\n", "9,Daniel,Whitfield,d@example.com,,2009,,\n");
  assert.equal(result.pairs[0]?.evidence.name, "compatible");
  assert.equal(result.pairs[0]?.status, "review");
});

test("same name with two contradicting details and no shared identifier is kept separate", () => {
  const result = run(
    "1,Jordan,Lee,,206-555-0110,2016,,\n",
    "9,Jordan,Lee,j@example.com,503-555-0111,2004,,\n",
  );
  assert.equal(result.pairs[0]?.status, "distinct");
  assert.equal(result.members.length, 2);
});

test("unrelated people with the same last name are not even candidates", () => {
  const result = run("1,Morgan,Lee,,,,,\n", "9,Jordan,Lee,,,,,\n");
  assert.deepEqual(result.pairs, []);
});

test("an auto-eligible pair with a competing candidate goes to review", () => {
  const result = run(
    "1,Morgan,Ellis,,312-555-0101,,,\n",
    "8,Morgan,Ellis,,312-555-0101,,,\n9,Morgan,Ellis,,312-555-0101,,,\n",
  );
  assert.ok(result.pairs.every((p) => p.status === "review"));
  assert.match(result.pairs[0]?.statusReason ?? "", /also has another possible match/);
});

test("complementary fields are filled, and every retained value carries provenance", () => {
  const result = run("1,Priya,Nakamura,,617-555-0102,2015,Somerville,\n", "9,Priya,Nakamura,p@example.com,+1 617 555 0102,,,\n");
  const member = result.members[0]!;
  assert.deepEqual(member.refs, ["a:2", "b:2"]);
  assert.deepEqual(member.fields.graduation_year, { value: "2015", sources: [{ ref: "a:2", raw: "2015" }] });
  assert.deepEqual(member.fields.email, { value: "p@example.com", sources: [{ ref: "b:2", raw: "p@example.com" }] });
  assert.deepEqual(member.fields.phone.sources, [
    { ref: "a:2", raw: "617-555-0102" },
    { ref: "b:2", raw: "+1 617 555 0102" },
  ]);
  assert.deepEqual(result.conflicts, []);
});

test("values equal after normalization agree, keeping the first source's spelling", () => {
  const result = run("1,Lucía,García,,305-555-0104,,,\n", "9,Lucia,Garcia,,305-555-0104,,,\n");
  assert.equal(result.members[0]?.fields.first_name.value, "Lucía");
  assert.equal(result.members[0]?.fields.first_name.sources.length, 2);
  assert.deepEqual(result.conflicts, []);
});

const BRENNAN = ["1,Casey,Brennan,,415-555-0105,2011,,\n", "9,Casey,Brennan,,415-555-0105,2001,,\n"] as const;
const YEAR_CONFLICT = "conflict:graduation_year:a:2+b:2";

test("disagreeing values create an open conflict instead of overwriting", () => {
  const result = run(...BRENNAN);
  assert.equal(result.pairs[0]?.status, "auto");
  assert.deepEqual(result.members[0]?.fields.graduation_year, {
    value: null,
    sources: [],
    conflictId: YEAR_CONFLICT,
    resolution: "unresolved",
  });
  assert.deepEqual(result.conflicts[0]?.options, [
    { option: "A", value: "2011", sources: [{ ref: "a:2", raw: "2011" }] },
    { option: "B", value: "2001", sources: [{ ref: "b:2", raw: "2001" }] },
  ]);
  assert.equal(result.conflicts[0]?.status, "open");
});

test("field decisions resolve conflicts with recorded provenance", () => {
  const chosen = run(...BRENNAN, [
    { type: "field", itemId: YEAR_CONFLICT, action: "use_value", value: "2011", origin: "source", decidedAt: FIXED_TIME },
  ]);
  assert.deepEqual(chosen.members[0]?.fields.graduation_year, {
    value: "2011",
    sources: [{ ref: "a:2", raw: "2011" }],
    conflictId: YEAR_CONFLICT,
    resolution: "reviewer_chose_source_value",
  });
  assert.equal(chosen.conflicts[0]?.status, "resolved");

  const typed = run(...BRENNAN, [
    { type: "field", itemId: YEAR_CONFLICT, action: "use_value", value: "2010", origin: "reviewer", decidedAt: FIXED_TIME },
  ]);
  assert.equal(typed.members[0]?.fields.graduation_year.value, "2010");
  assert.equal(typed.members[0]?.fields.graduation_year.resolution, "reviewer_entered_value");

  const blank = run(...BRENNAN, [{ type: "field", itemId: YEAR_CONFLICT, action: "leave_blank", decidedAt: FIXED_TIME }]);
  assert.equal(blank.members[0]?.fields.graduation_year.value, null);
  assert.equal(blank.members[0]?.fields.graduation_year.resolution, "reviewer_left_blank");
});

test("notes keep every distinct value instead of conflicting", () => {
  const result = run(
    '1,Kofi,Mensah,,301-555-0108,,,"Moved, 2010"\n',
    "9,Kofi,Mensah,,301-555-0108,,,Board member\n",
  );
  assert.equal(result.members[0]?.fields.notes.value, "Moved, 2010 | Board member");
  assert.deepEqual(result.conflicts, []);
});

test("match decisions override the rules in both directions", () => {
  const pairId = "match:a:2+b:2";
  const confirmed = run("1,Sam,Rivera,,,2014,,\n", "9,Samantha,Rivera,,,2014,,\n", [
    { type: "match", itemId: pairId, verdict: "same_person", decidedAt: FIXED_TIME },
  ]);
  assert.equal(confirmed.pairs[0]?.status, "confirmed");
  assert.equal(confirmed.members.length, 1);
  assert.equal(confirmed.conflicts[0]?.id, "conflict:first_name:a:2+b:2", "Sam vs Samantha becomes a conflict");

  const split = run("1,Morgan,Ellis,,312-555-0101,,,\n", "9,Morgan,Ellis,,312-555-0101,,,\n", [
    { type: "match", itemId: pairId, verdict: "different_people", decidedAt: FIXED_TIME },
  ]);
  assert.equal(split.pairs[0]?.status, "rejected");
  assert.equal(split.members.length, 2);
});

test("contradictory decisions are reported, and decisions for vanished items are stale", () => {
  const records = recordsFrom({
    a: HEADER + "1,Dan,Whitfield,d@example.com,,,,\n",
    b: HEADER + "8,Daniel,Whitfield,d@example.com,,,,\n9,D,Whitfield,d@example.com,,,,\n",
  });
  const decide = (itemId: string, verdict: "same_person" | "different_people"): Decision => ({
    type: "match",
    itemId,
    verdict,
    decidedAt: FIXED_TIME,
  });
  const result = reconcile(records, [
    decide("match:a:2+b:2", "same_person"),
    decide("match:b:2+b:3", "same_person"),
    decide("match:a:2+b:3", "different_people"),
    decide("conflict:city:a:2+b:2", "same_person"),
  ]);
  assert.equal(result.inconsistencies.length, 1);
  assert.match(result.inconsistencies[0] ?? "", /a:2 and b:3 were marked as different people/);
  assert.deepEqual(result.staleDecisions.map((s) => s.decision.itemId), ["conflict:city:a:2+b:2"]);
});
