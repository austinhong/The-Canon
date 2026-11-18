(function (root) {
  const CANON = root.CANON;
  const PAIR_LIMIT = 3;
  const STANDING_START = 3;
  const TAP_MS = 60 * 1000;
  const HOST_MS = 30 * 60 * 1000;
  const CHALLENGE_MS = 24 * 60 * 60 * 1000;
  const WEEKDAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

  function fail(error) {
    return { ok: false, error };
  }

  function ok(state, message) {
    return { ok: true, state, message };
  }

  let bound = null;

  function bind(state) {
    bound = state || null;
  }

  function roster() {
    const people = (bound && bound.people) || [];
    const seen = new Set();
    const all = [];
    for (const member of [...people, ...CANON.students, ...CANON.hosts]) {
      if (!member || seen.has(member.id)) continue;
      seen.add(member.id);
      all.push(member);
    }
    return all;
  }

  function person(id) {
    return roster().find((member) => member.id === id) || null;
  }

  function isStudent(id) {
    const found = person(id);
    if (!found || found.role === "host") return false;
    if (CANON.hosts.some((host) => host.id === id)) return false;
    return true;
  }

  function appointed(state, item, id) {
    if (!item || !id) return false;
    if (id === item.hostId) return true;
    const named = (state.appointments && state.appointments[item.id]) || [];
    return named.includes(id);
  }

  function campusParts(now) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      weekday: "short",
      hourCycle: "h23",
    }).formatToParts(now);
    const get = (type) => parts.find((p) => p.type === type).value;
    const weekday = get("weekday").slice(0, 3);
    return {
      year: Number(get("year")),
      month: Number(get("month")),
      day: Number(get("day")),
      hour: Number(get("hour")),
      minute: Number(get("minute")),
      weekday,
      dayKey: `${get("year")}-${get("month")}-${get("day")}`,
      minutes: Number(get("hour")) * 60 + Number(get("minute")),
    };
  }

  function weekKey(now) {
    const c = campusParts(now);
    const date = new Date(Date.UTC(c.year, c.month - 1, c.day));
    const day = date.getUTCDay() || 7;
    date.setUTCDate(date.getUTCDate() + 4 - day);
    const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
    const week = Math.ceil(((date - yearStart) / 86400000 + 1) / 7);
    return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
  }

  function nextResetLabel(now) {
    const c = campusParts(now);
    const wd = WEEKDAYS[c.weekday];
    const add = wd === 1 ? 7 : (8 - wd) % 7;
    const when = new Date(Date.UTC(c.year, c.month - 1, c.day + add, 17, 0, 0));
    const label = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      weekday: "long",
      month: "long",
      day: "numeric",
    }).format(when);
    return `Votes clear ${label}, at midnight campus time.`;
  }

  function clockLabel(date) {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      hour: "numeric",
      minute: "2-digit",
    }).format(date);
  }

  function dayLabel(date) {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(date);
  }

  function standingOf(state, id) {
    if (state.standing[id] == null) return STANDING_START;
    return state.standing[id];
  }

  function pairKey(a, b) {
    return [a, b].sort().join("|");
  }

  function pairCount(state, a, b) {
    return state.pairs[pairKey(a, b)] || 0;
  }

  function isLivePhoto(photo) {
    return typeof photo === "string" && photo.startsWith("data:image/jpeg;base64,") && photo.length > 32 && photo.length < 500000;
  }

  function distanceMeters(lat1, lng1, lat2, lng2) {
    const r = 6371000;
    const p = Math.PI / 180;
    const dLat = (lat2 - lat1) * p;
    const dLng = (lng2 - lng1) * p;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1 * p) * Math.cos(lat2 * p) * Math.sin(dLng / 2) ** 2;
    return 2 * r * Math.asin(Math.sqrt(a));
  }

  function matchFence(lat, lng, fences) {
    let best = null;
    for (const fence of fences) {
      if (!fence) continue;
      const d = distanceMeters(lat, lng, fence.lat, fence.lng);
      if (d <= fence.radius && (!best || d < best.distance)) best = { fence, distance: d };
    }
    return best ? best.fence : null;
  }

  function book(state) {
    const extras = (state.bookAdditions || []).filter(
      (item) => !CANON.items.some((seed) => seed.id === item.id),
    );
    return [...CANON.items, ...extras];
  }

  function itemById(state, id) {
    return book(state).find((item) => item.id === id) || (state.suggestions || []).find((item) => item.id === id) || null;
  }

  function inBook(state, id) {
    return book(state).some((item) => item.id === id);
  }

  function hasCounted(state, itemId, studentId, stampId) {
    return state.proofs.some(
      (proof) =>
        proof.status === "counted" &&
        proof.itemId === itemId &&
        (studentId == null || proof.studentId === studentId) &&
        (stampId == null || proof.stampId === stampId),
    );
  }

  function hasPending(state, itemId, studentId, stampId) {
    return state.proofs.some(
      (proof) =>
        proof.status === "pending" &&
        proof.itemId === itemId &&
        proof.studentId === studentId &&
        (stampId == null || proof.stampId === stampId),
    );
  }

  function isPublic(state, item) {
    if (item.proposed) return true;
    if (!item.hidden) return true;
    return hasCounted(state, item.id);
  }

  function voteCount(state, id) {
    return (state.votes[id] || []).length;
  }

  function hasVote(state, id, studentId) {
    return (state.votes[id] || []).includes(studentId);
  }

  function rankable(state) {
    const published = book(state).filter((item) => isPublic(state, item));
    const proposed = (state.suggestions || []).map((item) => ({ ...item, proposed: true }));
    return [...published, ...proposed].sort((a, b) => {
      const diff = voteCount(state, b.id) - voteCount(state, a.id);
      if (diff) return diff;
      return a.title.localeCompare(b.title);
    });
  }

  function topList(state) {
    return rankable(state).filter((item) => voteCount(state, item.id) > 0).slice(0, 5);
  }

  function pointsOf(item) {
    if (!item) return 0;
    const direct = Number(item.points);
    if (Number.isFinite(direct) && direct > 0) return direct;
    const level = (CANON.difficulties || []).find((entry) => entry.id === item.difficulty);
    return level ? level.points : 1;
  }

  function categoryName(item) {
    const found = (CANON.categories || []).find((entry) => entry.id === item.category);
    return found ? found.name : "The college";
  }

  function methodLabel(item) {
    if (item.kind === "hosted") return "Host marks you present";
    if (item.mode === "all-halls") return "Every hall, same day";
    if (item.mode === "stamps") return "Each game, on site";
    return "On site, two phones";
  }

  function parseMinutes(hhmm) {
    const [h, m] = hhmm.split(":").map(Number);
    return h * 60 + m;
  }

  function hoursOpen(window, now) {
    const c = campusParts(now);
    const day = WEEKDAYS[c.weekday];
    if (window.days && !window.days.includes(day)) return false;
    const start = parseMinutes(window.start);
    const end = parseMinutes(window.end);
    if (end === 24 * 60) return c.minutes >= start;
    return c.minutes >= start && c.minutes < end;
  }

  function dayOfYear(year, month, day) {
    return Math.round((Date.UTC(year, month - 1, day) - Date.UTC(year, 0, 0)) / 86400000);
  }

  function sunriseDate(now, lat, lng) {
    const c = campusParts(now);
    const rad = Math.PI / 180;
    const n = dayOfYear(c.year, c.month, c.day);
    const lngHour = lng / 15;
    const t = n + (6 - lngHour) / 24;
    const M = 0.9856 * t - 3.289;
    let L = M + 1.916 * Math.sin(M * rad) + 0.02 * Math.sin(2 * M * rad) + 282.634;
    L = ((L % 360) + 360) % 360;
    let RA = Math.atan(0.91764 * Math.tan(L * rad)) / rad;
    RA = ((RA % 360) + 360) % 360;
    const Lq = Math.floor(L / 90) * 90;
    const RAq = Math.floor(RA / 90) * 90;
    RA = (RA + (Lq - RAq)) / 15;
    const sinDec = 0.39782 * Math.sin(L * rad);
    const cosDec = Math.cos(Math.asin(sinDec));
    const cosH = (Math.cos(90.833 * rad) - sinDec * Math.sin(lat * rad)) / (cosDec * Math.cos(lat * rad));
    if (cosH > 1 || cosH < -1) return null;
    const H = (360 - Math.acos(cosH) / rad) / 15;
    let UT = H + RA - 0.06571 * t - 6.622 - lngHour;
    UT = ((UT % 24) + 24) % 24;
    const hours = Math.floor(UT);
    const minutes = Math.floor((UT - hours) * 60);
    const seconds = Math.round(((UT - hours) * 60 - minutes) * 60);
    return new Date(Date.UTC(c.year, c.month - 1, c.day, hours, minutes, seconds));
  }

  function diningRecord(state, studentId, itemId, now) {
    const key = `${studentId}|${itemId}`;
    const record = state.dining[key];
    const day = campusParts(now).dayKey;
    if (!record || record.day !== day) return { key, day, halls: [], lastPhoto: null, fresh: !record || record.day !== day };
    return { key, ...record, fresh: false };
  }

  function stampOpen(stamp, now) {
    const start = new Date(stamp.start).getTime();
    const end = new Date(stamp.end).getTime();
    return now.getTime() >= start && now.getTime() < end;
  }

  function nextStamp(item, state, student, now) {
    if (!item.stamps) return null;
    const remaining = item.stamps.filter((stamp) => !hasCounted(state, item.id, student.id, stamp.id));
    return remaining.find((stamp) => stampOpen(stamp, now)) || remaining[0] || null;
  }

  function openness(state, item, student, now, world) {
    bind(state);
    if (item.proposed) return { open: false, reason: "On the ballot until Monday. It cannot be finished yet." };
    if (!isStudent(student.id)) return { open: false, reason: "Hosts mark presence. They do not finish items." };
    if (standingOf(state, student.id) <= 0) {
      return { open: false, reason: "No challenges left, so a finish would not count." };
    }
    if (item.mode === "stamps") {
      const upcoming = nextStamp(item, state, student, now);
      if (!upcoming) return { open: false, reason: "Both games already count." };
      if (hasPending(state, item.id, student.id, upcoming.id)) {
        return { open: false, reason: "This game is already waiting out the challenge day." };
      }
      if (!stampOpen(upcoming, now)) {
        return { open: false, reason: `${upcoming.label} opens ${dayLabel(new Date(upcoming.start))}.` };
      }
      return { open: true, reason: `Open now · ${upcoming.label}` };
    }
    if (item.mode !== "stamps" && hasCounted(state, item.id, student.id)) {
      return { open: false, reason: "This already counts for you." };
    }
    if (item.mode !== "stamps" && hasPending(state, item.id, student.id)) {
      return { open: false, reason: "This is already waiting out the challenge day." };
    }
    if (item.window?.type === "snow") {
      if (!world || world.snowing == null) {
        return {
          open: false,
          reason: world && world.failed
            ? "Campus weather could not be checked, so this stays closed."
            : "Checking whether it is snowing on campus.",
        };
      }
      if (!world.snowing) return { open: false, reason: "It is not snowing on campus, so this stays closed." };
    } else if (item.window?.type === "semester") {
      const c = campusParts(now);
      if (!item.window.months.includes(c.month)) {
        return { open: false, reason: "This opens in the last semester, January through May." };
      }
      if (student.year !== "senior") return { open: false, reason: "Only seniors can finish this." };
      if (!hoursOpen(item.window, now)) return { open: false, reason: "This is closed at this hour." };
    } else if (item.window?.type === "sunrise") {
      const place = CANON.places[item.placeId];
      const rise = sunriseDate(now, place.lat, place.lng);
      if (!rise) return { open: false, reason: "Sunrise could not be calculated for this place." };
      const margin = (item.window.marginMin || 20) * 60 * 1000;
      const open = Math.abs(now.getTime() - rise.getTime()) <= margin;
      const from = clockLabel(new Date(rise.getTime() - margin));
      const to = clockLabel(new Date(rise.getTime() + margin));
      if (!open) return { open: false, reason: `Opens at sunrise, ${from}–${to} campus time.` };
    } else if (item.window?.type === "hours") {
      if (!hoursOpen(item.window, now)) return { open: false, reason: "The time window is closed." };
    }
    if (item.mode === "all-halls") {
      const record = diningRecord(state, student.id, item.id, now);
      if (record.halls.length >= item.halls.length) {
        return { open: true, reason: "Every hall is in. A second phone can tap the code from here." };
      }
      return { open: true, reason: `Open now · ${record.halls.length} of ${item.halls.length} halls` };
    }
    return { open: true, reason: "Open now" };
  }

  function fences(item, state, student, now) {
    if (item.mode === "all-halls") return item.halls.map((id) => CANON.places[id]);
    if (item.mode === "stamps") {
      const stamp = nextStamp(item, state, student, now);
      if (!stamp || !stampOpen(stamp, now)) return [];
      return [CANON.places[stamp.placeId]];
    }
    if (item.mode === "own-college") {
      const placeId = CANON.collegePlace[student.college];
      return placeId ? [CANON.places[placeId]] : [];
    }
    return CANON.places[item.placeId] ? [CANON.places[item.placeId]] : [];
  }

  function allowedPlace(item, student, placeId) {
    if (item.mode === "all-halls") return item.halls.includes(placeId);
    if (item.mode === "stamps") return item.stamps.some((stamp) => stamp.placeId === placeId);
    if (item.mode === "own-college") return CANON.collegePlace[student.college] === placeId;
    return item.placeId === placeId;
  }

  function requireAttempt(state, item, student, input, now, world) {
    if (!item || item.proposed || !inBook(state, item.id)) return fail("This is still on the ballot.");
    if (!isStudent(student.id)) return fail("Hosts mark presence. They do not finish items.");
    if (input.placeOk !== true) return fail("You were not on site. Nothing was saved.");
    if (!allowedPlace(item, student, input.placeId)) return fail("That place is not this item.");
    if (!isLivePhoto(input.photo)) return fail("A live camera photo is required. Gallery uploads do not count.");
    const open = openness(state, item, student, now, world || { snowing: null });
    if (!open.open) return fail(open.reason);
    return null;
  }

  function rememberPair(state, a, b) {
    const key = pairKey(a, b);
    state.pairs[key] = (state.pairs[key] || 0) + 1;
  }

  function dropStanding(state, id) {
    if (!id) return;
    state.standing[id] = Math.max(0, standingOf(state, id) - 1);
  }

  function createProof(state, fields, now) {
    state.proofs.push({
      id: fields.id || `proof-${fields.itemId}-${now.getTime()}`,
      itemId: fields.itemId,
      studentId: fields.studentId,
      witnessId: fields.witnessId || null,
      hostId: fields.hostId || null,
      stampId: fields.stampId || null,
      placeName: fields.placeName,
      halls: fields.halls || null,
      photo: fields.photo,
      witnessPhoto: fields.witnessPhoto || null,
      status: "pending",
      createdAt: now.getTime(),
      challengeUntil: now.getTime() + CHALLENGE_MS,
      challenges: [],
    });
  }

  function resolve(state, now) {
    for (const proof of state.proofs) {
      if (proof.status === "pending" && now.getTime() >= proof.challengeUntil) proof.status = "counted";
    }
    const time = now.getTime();
    for (const id of Object.keys(state.taps)) {
      if (state.taps[id].expires <= time) delete state.taps[id];
    }
    state.hostQueue = state.hostQueue.filter((request) => request.expires > time);
  }

  function rotate(state, now) {
    const key = weekKey(now);
    if (state.weekKey === key) return;
    const top = topList(state);
    state.lastCrown = {
      weekKey: state.weekKey,
      titles: top.map((item) => item.title),
    };
    for (const item of top) {
      if (!item.proposed) continue;
      state.bookAdditions.push({
        id: item.id,
        title: item.title,
        rule: item.rule,
        season: "Voted in",
        kind: item.kind,
        mode: "place",
        placeId: item.placeId || null,
        placeName: item.placeName || (CANON.places[item.placeId] ? CANON.places[item.placeId].name : ""),
        hostId: item.hostId || null,
        hidden: false,
        window: item.window,
        category: item.category || "college",
        points: pointsOf(item),
        difficulty: item.difficulty || null,
      });
      state.suggestions = state.suggestions.filter((suggestion) => suggestion.id !== item.id);
    }
    state.votes = {};
    state.weekKey = key;
  }

  function prepare(state, now) {
    const next = structuredClone(state);
    bind(next);
    resolve(next, now);
    rotate(next, now);
    return next;
  }

  function vote(state, studentId, itemId, now) {
    const next = prepare(state, now);
    if (!isStudent(studentId)) return fail("Hosts don't vote on the book.");
    const item = itemById(next, itemId);
    if (!item) return fail("That item is not on the book.");
    if (item.proposed && item.authorId === studentId) return fail("You can't vote for your own proposal.");
    if (item.hidden && !hasCounted(next, item.id)) return fail("Sealed items stay off the vote until someone finishes one.");
    const current = next.votes[itemId] || [];
    next.votes[itemId] = current.includes(studentId)
      ? current.filter((id) => id !== studentId)
      : [...current, studentId];
    if (next.votes[itemId].length === 0) delete next.votes[itemId];
    return ok(next);
  }

  function resolvePlace(input) {
    const written = String(input.placeName || "").trim().replace(/\s+/g, " ");
    const places = Object.values(CANON.places);
    const needle = (written || String(input.placeId || "")).trim().replace(/\s+/g, " ");
    if (needle.length < 2 || needle.length > 80) return null;
    const lower = needle.toLowerCase();
    const exact = places.find((entry) => entry.id === lower || entry.name.toLowerCase() === lower);
    if (exact) return { id: exact.id, name: exact.name };
    const loose = places.filter(
      (entry) => entry.name.toLowerCase().includes(lower) || lower.includes(entry.name.toLowerCase()),
    );
    if (loose.length === 1) return { id: loose[0].id, name: loose[0].name };
    return { id: null, name: needle };
  }

  function suggest(state, input, now) {
    const next = prepare(state, now);
    if (!isStudent(input.studentId)) return fail("Only students can propose an item.");
    if (next.suggestions.some((item) => item.authorId === input.studentId)) {
      return fail("You already have a proposal on the ballot.");
    }
    const title = (input.title || "").trim();
    const rule = (input.rule || "").trim();
    if (title.length < 8 || title.length > 80) return fail("Give the item a title, at least a few words.");
    if (rule.length < 8 || rule.length > 200) return fail("Say what counts, in a sentence or two.");
    const place = resolvePlace(input);
    if (!place) return fail("Name a campus place, in a few words.");
    const choice = CANON.windowChoices.find((option) => option.id === input.windowId);
    if (!choice) return fail("Pick the hours when this can be finished.");
    if (input.kind !== "presence" && input.kind !== "hosted") return fail("Say whether this is on site or hosted.");
    if (input.kind === "hosted" && !CANON.hosts.some((host) => host.id === input.hostId)) {
      return fail("A hosted item needs a real host.");
    }
    const category = (CANON.categories || []).find((entry) => entry.id === input.category);
    if (!category) return fail("Pick the section this belongs in.");
    const level = (CANON.difficulties || []).find((entry) => entry.id === input.difficulty);
    if (!level) return fail("Pick how hard this is.");
    const id = input.id || `p-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")}`;
    if (itemById(next, id)) return fail("That item is already on the book.");
    next.suggestions.push({
      id,
      title,
      rule,
      placeId: place.id,
      placeName: place.name,
      kind: input.kind,
      hostId: input.kind === "hosted" ? input.hostId : null,
      window: choice.window,
      authorId: input.studentId,
      proposed: true,
      category: category.id,
      difficulty: level.id,
      points: level.points,
    });
    return ok(next, "It's on the ballot.");
  }

  function demoFinish(state, input, now) {
    const next = prepare(state, now);
    const student = person(input.studentId);
    const item = itemById(next, input.itemId);
    if (!student || !isStudent(student.id)) return fail("Only a student can enter a finish.");
    if (!student.college) return fail("Choose your residential college first.");
    if (!item || item.proposed || !inBook(next, item.id)) return fail("That task is not in the book yet.");
    if (hasCounted(next, item.id, student.id) || hasPending(next, item.id, student.id)) {
      return fail("This task is already entered for you.");
    }
    const placeName = String(input.placeName || "").trim().replace(/\s+/g, " ");
    if (placeName.length < 2 || placeName.length > 80) return fail("Name the person, in a few words.");
    next.proofs.push({
      id: input.proofId || `demo-${item.id}-${student.id}`,
      itemId: item.id,
      studentId: student.id,
      witnessId: null,
      hostId: null,
      stampId: null,
      placeName,
      halls: null,
      photo: null,
      witnessPhoto: null,
      status: "counted",
      demo: true,
      createdAt: now.getTime(),
      challengeUntil: now.getTime(),
      challenges: [],
    });
    return ok(next, `${item.title} is in. ${pointsOf(item)} points for ${student.college}.`);
  }

  function putTap(state, input, now, extra) {
    state.taps[input.studentId] = {
      code: input.code,
      itemId: input.itemId,
      studentId: input.studentId,
      placeId: input.placeId,
      placeName: input.placeName,
      photo: input.photo,
      stampId: extra.stampId || null,
      halls: extra.halls || null,
      expires: now.getTime() + TAP_MS,
    };
  }

  function beginPresence(state, input, now, world) {
    const next = prepare(state, now);
    const student = person(input.studentId);
    const item = itemById(next, input.itemId);
    const blocked = requireAttempt(next, item, student, input, now, world);
    if (blocked) return blocked;
    if (item.kind !== "presence") return fail("The host marks this one. A friend cannot.");
    if (!/^\d{6}$/.test(input.code || "")) return fail("The tap code did not generate.");

    if (item.mode === "all-halls") {
      const record = diningRecord(next, student.id, item.id, now);
      const halls = record.fresh ? [] : [...record.halls];
      const already = halls.includes(input.placeId);
      if (!already) halls.push(input.placeId);
      next.dining[record.key] = { day: record.day, halls, lastPhoto: input.photo };
      if (halls.length < item.halls.length) {
        delete next.taps[student.id];
        const name = CANON.places[input.placeId].name;
        return ok(
          next,
          already
            ? `${name} is already in. ${halls.length} of ${item.halls.length} halls.`
            : `${name} counts. ${halls.length} of ${item.halls.length} halls.`,
        );
      }
      putTap(next, input, now, { halls });
      return ok(next, "Every hall is in. The other phone has one minute to tap.");
    }

    let stampId = null;
    if (item.mode === "stamps") {
      const stamp = item.stamps.find((entry) => entry.placeId === input.placeId && stampOpen(entry, now));
      if (!stamp) return fail("That game is not being played right now.");
      if (hasCounted(next, item.id, student.id, stamp.id) || hasPending(next, item.id, student.id, stamp.id)) {
        return fail("That game is already in.");
      }
      stampId = stamp.id;
    }
    putTap(next, input, now, { stampId });
    return ok(next, "Have the other phone enter this code within a minute.");
  }

  function confirmWitness(state, input, now, world) {
    const next = prepare(state, now);
    const witness = person(input.witnessId);
    const tap = next.taps[input.studentId];
    if (!tap || tap.itemId !== input.itemId) return fail("There is no live tap for this item.");
    if (now.getTime() > tap.expires) return fail("The tap expired. Start again on site.");
    if (tap.code !== input.code) return fail("That code does not match the other phone.");
    if (!witness || !isStudent(witness.id)) return fail("A student who was there has to be the second phone.");
    if (witness.id === tap.studentId) return fail("You can't witness yourself.");
    if (standingOf(next, witness.id) <= 0) return fail("The witness has no challenges left.");
    if (pairCount(next, tap.studentId, witness.id) >= PAIR_LIMIT) {
      return fail("You two have already confirmed each other three times. This one would not count.");
    }
    if (input.placeOk !== true) return fail("The witness was not on site. Nothing was saved.");
    if (input.placeId !== tap.placeId && !(tap.halls || []).includes(input.placeId)) {
      return fail("The witness is not at the place.");
    }
    if (!isLivePhoto(input.photo)) return fail("The witness needs a live camera photo. Gallery uploads do not count.");
    const item = itemById(next, tap.itemId);
    const open = openness(next, item, person(tap.studentId), now, world || { snowing: null });
    if (!open.open) return fail(open.reason);
    createProof(
      next,
      {
        id: input.proofId,
        itemId: tap.itemId,
        studentId: tap.studentId,
        witnessId: witness.id,
        stampId: tap.stampId,
        placeName: tap.placeName,
        halls: tap.halls,
        photo: tap.photo,
        witnessPhoto: input.photo,
      },
      now,
    );
    rememberPair(next, tap.studentId, witness.id);
    delete next.taps[tap.studentId];
    if (tap.halls) delete next.dining[`${tap.studentId}|${tap.itemId}`];
    return ok(next, "It's in. Other colleges have a day to challenge it.");
  }

  function beginHosted(state, input, now, world) {
    const next = prepare(state, now);
    const student = person(input.studentId);
    const item = itemById(next, input.itemId);
    const blocked = requireAttempt(next, item, student, input, now, world);
    if (blocked) return blocked;
    if (item.kind !== "hosted") return fail("This one needs a second student phone, not a host.");
    next.hostQueue = next.hostQueue.filter((request) => !(request.itemId === item.id && request.studentId === student.id));
    next.hostQueue.push({
      id: input.requestId,
      itemId: item.id,
      studentId: student.id,
      hostId: item.hostId,
      placeId: input.placeId,
      placeName: input.placeName,
      photo: input.photo,
      expires: now.getTime() + HOST_MS,
    });
    return ok(next, "The host can mark you present for the next half hour.");
  }

  function confirmHost(state, input, now) {
    const next = prepare(state, now);
    const request = next.hostQueue.find((entry) => entry.id === input.requestId);
    if (!request) return fail("That request expired or is already marked.");
    const itemForHost = itemById(next, request.itemId);
    if (!appointed(next, itemForHost, input.hostId)) return fail("Only the host of this item can mark it.");
    if (standingOf(next, input.hostId) <= 0) return fail("You have no challenges left to mark this.");
    if (standingOf(next, request.studentId) <= 0) return fail("The student has no challenges left.");
    if (input.placeOk !== true || input.placeId !== request.placeId) {
      return fail("You have to be at the place to mark them present. Nothing was saved.");
    }
    const item = itemById(next, request.itemId);
    const open = openness(next, item, person(request.studentId), now, { snowing: false });
    if (!open.open) return fail(open.reason);
    createProof(
      next,
      {
        id: input.proofId,
        itemId: request.itemId,
        studentId: request.studentId,
        hostId: input.hostId,
        placeName: request.placeName,
        photo: request.photo,
        stampId: null,
      },
      now,
    );
    next.hostQueue = next.hostQueue.filter((entry) => entry.id !== request.id);
    return ok(next, `${item.title} is marked. Other colleges have a day to challenge it.`);
  }

  function challenge(state, input, now) {
    const next = prepare(state, now);
    const student = person(input.studentId);
    if (!student || !isStudent(student.id)) return fail("Only a student from another college can challenge.");
    const proof = next.proofs.find((entry) => entry.id === input.proofId);
    if (!proof || proof.status !== "pending") return fail("This is no longer open to a challenge.");
    if (now.getTime() >= proof.challengeUntil) return fail("The challenge day is over.");
    if (!student.college || !CANON.colleges.some((college) => college.name === student.college)) {
      return fail("Choose your residential college before you challenge.");
    }
    if (proof.studentId === student.id || proof.witnessId === student.id) {
      return fail("The two people on the proof cannot challenge it.");
    }
    if (proof.challenges.some((entry) => entry.studentId === student.id)) return fail("You already challenged this.");
    proof.challenges.push({ studentId: student.id, college: student.college });
    const colleges = new Set(proof.challenges.map((entry) => entry.college));
    if (colleges.size >= 2) {
      proof.status = "rejected";
      dropStanding(next, proof.studentId);
      dropStanding(next, proof.witnessId || proof.hostId);
      return ok(next, "The challenge held. The item is struck, and both of them have one fewer challenge left.");
    }
    return ok(next, "Noted. It takes a second college before the item is struck.");
  }

  function blankState(now) {
    const standing = {};
    for (const member of [...CANON.students, ...CANON.hosts]) standing[member.id] = STANDING_START;
    return {
      weekKey: weekKey(now),
      youId: CANON.students[0].id,
      votes: {},
      suggestions: [],
      people: [],
      appointments: {},
      bookAdditions: [],
      proofs: [],
      pairs: {},
      dining: {},
      hostQueue: [],
      taps: {},
      standing,
      lastCrown: null,
    };
  }

  function initialState(now) {
    const state = blankState(now);
    state.votes = {
      sunrise: ["maya", "leo", "priya", "owen", "hana"],
      "the-game": ["leo", "sam", "ruth", "julian"],
      "dining-day": ["priya", "hana", "sam"],
      tea: ["owen", "ruth"],
      "library-note": ["maya"],
    };
    return state;
  }

  function scores(state) {
    bind(state);
    const map = Object.fromEntries(CANON.colleges.map((college) => [college.name, 0]));
    for (const proof of state.proofs) {
      if (proof.status !== "counted") continue;
      const owner = person(proof.studentId);
      if (!owner || map[owner.college] == null) continue;
      map[owner.college] += pointsOf(itemById(state, proof.itemId));
    }
    return CANON.colleges.map((college) => [college.name, map[college.name]]);
  }

  function noUserLocation(value, path, hits) {
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      if (/^(lat|lng|latitude|longitude|coords|accuracy)$/i.test(key)) hits.push(`${path}${key}`);
      noUserLocation(child, `${path}${key}.`, hits);
    }
  }

  function witnessChoices(state, studentId) {
    bind(state);
    return roster()
      .filter((student) => student.id !== studentId && isStudent(student.id))
      .map((student) => {
        const count = pairCount(state, studentId, student.id);
        let blocked = null;
        if (standingOf(state, student.id) <= 0) blocked = "no challenges left";
        else if (count >= PAIR_LIMIT) blocked = "worn out";
        return { id: student.id, name: student.name, college: student.college, count, blocked };
      });
  }

  root.CanonRules = {
    PAIR_LIMIT,
    STANDING_START,
    TAP_MS,
    CHALLENGE_MS,
    person,
    appointed,
    isStudent,
    campusParts,
    weekKey,
    nextResetLabel,
    distanceMeters,
    matchFence,
    book,
    itemById,
    voteCount,
    hasVote,
    rankable,
    topList,
    isPublic,
    methodLabel,
    pointsOf,
    categoryName,
    openness,
    fences,
    sunriseDate,
    prepare,
    vote,
    suggest,
    demoFinish,
    beginPresence,
    confirmWitness,
    beginHosted,
    confirmHost,
    challenge,
    blankState,
    initialState,
    scores,
    standingOf,
    pairCount,
    witnessChoices,
    noUserLocation,
    isLivePhoto,
    diningRecord,
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
