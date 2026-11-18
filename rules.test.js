const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const context = { console, Intl, Date, Math, structuredClone };
context.globalThis = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync(`${__dirname}/canon.js`, "utf8"), context);
vm.runInContext(fs.readFileSync(`${__dirname}/rules.js`, "utf8"), context);

const { CANON, CanonRules: rules } = context;
const NOW = new Date("2026-11-17T22:45:00Z");
const PHOTO = (mark) => `data:image/jpeg;base64,${mark}${"A".repeat(40)}`;

function coords(value) {
  const hits = [];
  rules.noUserLocation(value, "", hits);
  return hits;
}

function begin(state, itemId, placeId, studentId, photo) {
  return rules.beginPresence(
    state,
    { studentId, itemId, placeOk: true, placeId, placeName: CANON.places[placeId].name, photo, code: "123456" },
    NOW,
    { snowing: false },
  );
}

let state = rules.initialState(NOW);
const top = rules.topList(state).map((item) => item.id);
assert.equal(top.map(String).join("|"), "sunrise|the-game|dining-day|tea|library-note");
assert.match(rules.nextResetLabel(NOW), /Monday, November 23/);

const parts = rules.campusParts(NOW);
assert.equal(parts.weekday, "Tue");
assert.equal(parts.hour, 17);
assert.equal(parts.minute, 45);

const maya = rules.person("maya");
const book = Object.fromEntries(rules.book(state).map((item) => [item.id, item]));
assert.equal(rules.openness(state, book["other-major"], maya, NOW, { snowing: false }).open, false);
assert.equal(rules.openness(state, book.tea, maya, NOW, { snowing: false }).open, true);
assert.equal(rules.openness(state, book["library-note"], maya, NOW, { snowing: false }).open, true);
assert.match(rules.openness(state, book.sunrise, maya, NOW, { snowing: false }).reason, /Opens at sunrise/);
assert.match(rules.openness(state, book["the-game"], maya, NOW, { snowing: false }).reason, /Yale Bowl/);
assert.equal(rules.openness(state, book["the-game"], maya, new Date("2026-11-21T18:00:00Z"), { snowing: false }).open, true);
assert.match(rules.openness(state, book.seniors, maya, NOW, { snowing: false }).reason, /last semester/);
assert.match(rules.openness(state, book.seniors, rules.person("priya"), new Date("2027-03-15T16:00:00Z"), { snowing: false }).reason, /Only seniors/);
assert.equal(rules.openness(state, book.seniors, maya, new Date("2027-03-15T16:00:00Z"), { snowing: false }).open, true);
assert.match(rules.openness(state, book["first-snow"], maya, NOW, { snowing: false }).reason, /not snowing/);
assert.equal(rules.openness(state, book["first-snow"], maya, NOW, { snowing: true }).open, true);
assert.match(rules.openness(state, book["first-snow"], maya, NOW, { snowing: null, failed: true }).reason, /could not be checked/);

const rise = rules.sunriseDate(NOW, CANON.places["east-rock"].lat, CANON.places["east-rock"].lng);
const riseParts = rules.campusParts(rise);
assert.ok(riseParts.hour >= 6 && riseParts.hour <= 7, `sunrise hour ${riseParts.hour}:${riseParts.minute}`);
assert.equal(rules.openness(state, book.sunrise, maya, rise, { snowing: false }).open, true);

assert.equal(rules.matchFence(CANON.places.sterling.lat, CANON.places.sterling.lng, [CANON.places.sterling]).name, CANON.places.sterling.name);
assert.equal(rules.matchFence(0, 0, [CANON.places.sterling]), null);

state = rules.blankState(NOW);
let step = begin(state, "library-note", "sterling", "maya", PHOTO("B"));
assert.equal(step.ok, true, step.error);
state = step.state;
assert.equal(state.taps.maya.code, "123456");
assert.deepEqual(coords(state), []);

step = rules.confirmWitness(
  state,
  { studentId: "maya", witnessId: "maya", itemId: "library-note", code: "123456", placeOk: true, placeId: "sterling", photo: PHOTO("W"), proofId: "p1" },
  NOW,
  { snowing: false },
);
assert.equal(step.ok, false);

step = rules.confirmWitness(
  state,
  { studentId: "maya", witnessId: "leo", itemId: "library-note", code: "000000", placeOk: true, placeId: "sterling", photo: PHOTO("W"), proofId: "p1" },
  NOW,
  { snowing: false },
);
assert.match(step.error, /does not match/);

step = rules.confirmWitness(
  state,
  { studentId: "maya", witnessId: "leo", itemId: "library-note", code: "123456", placeOk: false, placeId: "sterling", photo: PHOTO("W"), proofId: "p1" },
  NOW,
  { snowing: false },
);
assert.match(step.error, /not on site/);

step = rules.beginPresence(
  state,
  { studentId: "maya", itemId: "library-note", placeOk: true, placeId: "sterling", placeName: "Sterling", photo: "data:image/png;base64,AAAA", code: "123456" },
  NOW,
  { snowing: false },
);
assert.match(step.error, /live camera/);

step = rules.confirmWitness(
  state,
  { studentId: "maya", witnessId: "leo", itemId: "library-note", code: "123456", placeOk: true, placeId: "sterling", photo: PHOTO("W"), proofId: "p1" },
  NOW,
  { snowing: false },
);
assert.equal(step.ok, true, step.error);
state = step.state;
assert.equal(state.proofs[0].status, "pending");
assert.equal(state.proofs[0].photo.startsWith("data:image/jpeg"), true);
assert.equal(rules.pairCount(state, "maya", "leo"), 1);
assert.deepEqual(coords(state), []);
assert.equal(state.taps.maya, undefined);

step = rules.challenge(state, { studentId: "maya", proofId: "p1" }, NOW);
assert.match(step.error, /cannot challenge/);
step = rules.challenge(state, { studentId: "cole", proofId: "p1" }, NOW);
assert.equal(step.ok, true, step.error);
state = step.state;
assert.equal(state.proofs[0].status, "pending");
step = rules.challenge(state, { studentId: "priya", proofId: "p1" }, NOW);
assert.equal(step.ok, true, step.error);
state = step.state;
assert.equal(state.proofs[0].status, "pending");
step = rules.challenge(state, { studentId: "nina", proofId: "p1" }, NOW);
assert.equal(step.ok, true, step.error);
state = step.state;
assert.equal(state.proofs[0].status, "rejected");
assert.equal(rules.standingOf(state, "maya"), 2);
assert.equal(rules.standingOf(state, "leo"), 2);
assert.equal(rules.scores(state).find(([college]) => college === "Silliman")[1], 0);

state = rules.blankState(NOW);
state.pairs["leo|maya"] = 3;
step = begin(state, "library-note", "sterling", "maya", PHOTO("B"));
state = step.state;
step = rules.confirmWitness(
  state,
  { studentId: "maya", witnessId: "leo", itemId: "library-note", code: "123456", placeOk: true, placeId: "sterling", photo: PHOTO("W"), proofId: "p2" },
  NOW,
  { snowing: false },
);
assert.match(step.error, /three times/);

state = rules.blankState(NOW);
const dining = rules.itemById(state, "dining-day");
let photoAKept = false;
dining.halls.forEach((hall, index) => {
  const shot = index === 0 ? PHOTO("FIRST") : PHOTO("LAST");
  step = begin(state, "dining-day", hall, "maya", shot);
  assert.equal(step.ok, true, step.error);
  state = step.state;
  if (index === 0) photoAKept = JSON.stringify(state).includes("FIRST");
  if (index === 1) assert.equal(JSON.stringify(state).includes("FIRST"), false);
});
assert.equal(photoAKept, true);
assert.equal(state.taps.maya.halls.length, 14);
step = rules.confirmWitness(
  state,
  { studentId: "maya", witnessId: "owen", itemId: "dining-day", code: "123456", placeOk: true, placeId: dining.halls[3], photo: PHOTO("W"), proofId: "dine" },
  NOW,
  { snowing: false },
);
assert.equal(step.ok, true, step.error);
state = step.state;
assert.equal(state.proofs[0].status, "pending");
assert.deepEqual(coords(state), []);
const later = new Date(NOW.getTime() + rules.CHALLENGE_MS + 1000);
state = rules.prepare(state, later);
assert.equal(state.proofs[0].status, "counted");
assert.equal(rules.scores(state).find(([college]) => college === "Silliman")[1], rules.pointsOf(rules.itemById(state, "dining-day")));

state = rules.blankState(NOW);
step = rules.beginHosted(
  state,
  { studentId: "leo", itemId: "tea", placeOk: true, placeId: "silliman", placeName: "Silliman", photo: PHOTO("H"), requestId: "req-1" },
  NOW,
  { snowing: false },
);
assert.equal(step.ok, true, step.error);
state = step.state;
step = rules.confirmHost(state, { requestId: "req-1", hostId: "host-tea", placeOk: false, placeId: "silliman", proofId: "tea-1" }, NOW);
assert.match(step.error, /at the place/);
step = rules.confirmHost(state, { requestId: "req-1", hostId: "host-prof", placeOk: true, placeId: "silliman", proofId: "tea-1" }, NOW);
assert.match(step.error, /Only the host/);
step = rules.confirmHost(state, { requestId: "req-1", hostId: "host-tea", placeOk: true, placeId: "silliman", proofId: "tea-1" }, NOW);
assert.equal(step.ok, true, step.error);
state = step.state;
assert.equal(state.proofs[0].hostId, "host-tea");
assert.equal(state.proofs[0].witnessId, null);

state = rules.blankState(NOW);
step = rules.suggest(
  state,
  { id: "late-exhibit", studentId: "maya", title: "Close the art gallery", rule: "Stay until the guard asks you to leave.", placeId: "lc", windowId: "evening", kind: "presence", category: "letters", difficulty: "modest" },
  NOW,
);
assert.equal(step.ok, true, step.error);
state = step.state;
step = rules.vote(state, "maya", "late-exhibit", NOW);
assert.match(step.error, /own proposal/);
step = rules.vote(state, "leo", "late-exhibit", NOW);
state = step.state;
step = rules.vote(state, "priya", "late-exhibit", NOW);
state = step.state;
step = rules.vote(state, "owen", "late-exhibit", NOW);
state = step.state;
step = rules.vote(state, "hana", "late-exhibit", NOW);
state = step.state;
step = rules.vote(state, "sam", "late-exhibit", NOW);
state = step.state;
assert.equal(rules.topList(state)[0].id, "late-exhibit");
assert.equal(rules.inBook ? false : rules.itemById(state, "late-exhibit").proposed, true);
state.weekKey = "1999-W01";
state = rules.prepare(state, NOW);
assert.equal(state.suggestions.length, 0);
assert.equal(state.bookAdditions[0].id, "late-exhibit");
assert.equal(state.bookAdditions[0].window.type, "hours");
assert.equal(state.bookAdditions[0].points, 2);
assert.equal(state.bookAdditions[0].category, "letters");
assert.equal(Object.keys(state.votes).length, 0);
assert.equal(state.lastCrown.titles[0], "Close the art gallery");
assert.equal(rules.weekKey(NOW), state.weekKey);

state = rules.blankState(NOW);
step = rules.demoFinish(state, { studentId: "maya", itemId: "library-note", placeName: "Sterling Memorial Library", proofId: "demo-1" }, NOW);
assert.equal(step.ok, true, step.error);
state = step.state;
assert.equal(state.proofs[0].status, "counted");
assert.equal(state.proofs[0].demo, true);
assert.equal(rules.scores(state).find(([college]) => college === "Silliman")[1], 2);
assert.deepEqual(coords(state), []);
step = rules.demoFinish(state, { studentId: "maya", itemId: "library-note", placeName: "Sterling again" }, NOW);
assert.match(step.error, /already entered/);
step = rules.demoFinish(state, { studentId: "maya", itemId: "sunrise", placeName: " " }, NOW);
assert.match(step.error, /person/);

state = rules.blankState(NOW);
step = rules.suggest(
  state,
  { id: "beinecke-hour", studentId: "leo", title: "Sit in Beinecke at dusk", rule: "Stay until the lights come up in the stacks.", placeName: "Beinecke Library", windowId: "evening", kind: "presence", category: "letters", difficulty: "modest" },
  NOW,
);
assert.equal(step.ok, true, step.error);
assert.equal(step.state.suggestions[0].placeId, null);
assert.equal(step.state.suggestions[0].placeName, "Beinecke Library");
step = rules.suggest(
  rules.blankState(NOW),
  { id: "silliman-hour", studentId: "leo", title: "Sit in Silliman at dusk", rule: "Stay until the lights come up in the hall.", placeName: "Silliman", windowId: "evening", kind: "presence", category: "letters", difficulty: "modest" },
  NOW,
);
assert.equal(step.ok, true, step.error);
assert.equal(step.state.suggestions[0].placeId, "silliman");

console.log("rules ok");
