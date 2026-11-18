(function () {
  const rules = window.CanonRules;
  const app = document.getElementById("app");
  const authErrors = {
    student: "Yale signed you in, but did not confirm that this NetID belongs to a Yale College student.",
    denied: "Yale did not accept this book as a registered service. Identity and Access Management has to allow the callback URL, limited to students.",
    ticket: "The Yale sign-in ticket was not valid. Start again from this page.",
    college: "That is not one of the fourteen residential colleges.",
  };

  let state = null;
  let me = null;
  let world = { snowing: null };
  let notice = "";
  let noticePage = "";
  let noticeTimer = 0;
  let busy = false;
  let saving = false;
  let showManual = false;
  let confirmOut = false;
  let painted = "";
  const filters = {
    vote: { find: "", section: "", difficulty: "", votes: "" },
    finish: { find: "", section: "", difficulty: "", votes: "" },
  };

  function mount() {
    const nodes = [];
    for (let i = 0; i < arguments.length; i += 1) {
      if (arguments[i] != null && arguments[i] !== false) nodes.push(arguments[i]);
    }
    app.replaceChildren(...nodes);
  }

  function you() {
    return (me && rules.person(me.id)) || me;
  }

  async function commit(action, payload) {
    saving = true;
    const response = await fetch("/api/action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.assign({ action }, payload || {})),
    });
    const result = await response.json();
    saving = false;
    if (!result.ok) {
      setNotice(result.error || "The book could not record that.");
      if (result.user) me = result.user;
      render();
      return;
    }
    state = result.state;
    me = result.user || me;
    setNotice(result.message || "", true);
    render();
  }

  function surface() {
    if (!me) return "gate";
    if (!me.college) return "college";
    return page();
  }

  function setNotice(message, momentary) {
    notice = message || "";
    noticePage = notice ? surface() : "";
    clearTimeout(noticeTimer);
    noticeTimer = 0;
    if (!notice || !momentary) return;
    const shownOn = noticePage;
    noticeTimer = setTimeout(() => {
      if (noticePage !== shownOn) return;
      notice = "";
      noticePage = "";
      const node = document.querySelector("main .notice");
      if (node) node.remove();
    }, 2400);
  }

  function banner() {
    if (!notice || noticePage !== surface()) return null;
    return h("p", { class: "notice", role: "status" }, notice);
  }

  function h(tag, attrs) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs || {})) {
      if (value == null || value === false) continue;
      if (key === "class") node.className = value;
      else node.setAttribute(key, value);
    }
    for (let i = 2; i < arguments.length; i += 1) append(node, arguments[i]);
    return node;
  }

  function append(node, child) {
    if (child == null || child === false) return;
    if (Array.isArray(child)) {
      child.forEach((entry) => append(node, entry));
      return;
    }
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }

  function photo(src, alt) {
    if (!rules.isLivePhoto(src)) return null;
    const img = h("img", { alt });
    img.src = src;
    return img;
  }

  function locate(fences) {
    const label = fences.length > 1 ? "a dining hall" : fences[0] ? fences[0].name : "the place";
    if (!fences.length) return Promise.resolve({ ok: false, error: "This item is not open at a place right now." });
    if (!navigator.geolocation) {
      return Promise.resolve({ ok: false, error: "This phone has no location check, so the item cannot count." });
    }
    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const match = rules.matchFence(pos.coords.latitude, pos.coords.longitude, fences);
          if (!match) {
            resolve({ ok: false, error: `You are not at ${label}. The check was not saved.` });
            return;
          }
          resolve({ ok: true, placeId: match.id ? match.id : placeIdOf(match), placeName: match.name });
        },
        () => resolve({ ok: false, error: "Location is off. An item only counts on site, so this one cannot." }),
        { enableHighAccuracy: true, maximumAge: 0, timeout: 12000 },
      );
    });
  }

  function placeIdOf(fence) {
    const places = window.CANON.places;
    return Object.keys(places).find((id) => places[id] === fence || (places[id].name === fence.name && places[id].lat === fence.lat));
  }

  function takePhoto() {
    const root = document.getElementById("camera");
    const video = document.getElementById("cam-video");
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return Promise.reject(new Error("The live camera is required. A photo from your gallery cannot count, and the camera was not available."));
    }
    return navigator.mediaDevices
      .getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false })
      .then(
        (stream) =>
          new Promise((resolve, reject) => {
            const stop = () => stream.getTracks().forEach((track) => track.stop());
            video.srcObject = stream;
            video.muted = true;
            video.playsInline = true;
            root.hidden = false;
            const finish = (err, url) => {
              document.getElementById("cam-capture").onclick = null;
              document.getElementById("cam-cancel").onclick = null;
              video.srcObject = null;
              root.hidden = true;
              stop();
              if (err) reject(err);
              else resolve(url);
            };
            video.onloadedmetadata = () => video.play().catch(() => {});
            document.getElementById("cam-capture").onclick = () => {
              const width = video.videoWidth;
              const height = video.videoHeight;
              if (!width || !height) {
                finish(new Error("The camera was not ready. Stay on this screen and try the photo again."));
                return;
              }
              const canvas = document.createElement("canvas");
              canvas.width = 640;
              canvas.height = Math.round((640 * height) / width);
              canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
              finish(null, canvas.toDataURL("image/jpeg", 0.65));
            };
            document.getElementById("cam-cancel").onclick = () => finish(new Error("cancel"));
          }),
      )
      .catch((err) => {
        if (err && err.message === "cancel") throw err;
        if (err && err.message && err.message !== "cancel" && !String(err.name || "").includes("Not")) throw err;
        throw new Error("The live camera is required. A photo from your gallery cannot count, and the camera was not available.");
      });
  }

  function code() {
    return String(Math.floor(100000 + Math.random() * 900000));
  }

  function uid(prefix) {
    return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
  }

  async function onCheckin(itemId) {
    if (busy) return;
    const item = rules.itemById(state, itemId);
    const student = you();
    const now = new Date();
    const spot = rules.fences(item, state, student, now);
    busy = true;
    render();
    const where = await locate(spot);
    if (!where.ok) {
      busy = false;
      setNotice(where.error);
      render();
      return;
    }
    let shot;
    try {
      shot = await takePhoto();
    } catch (err) {
      busy = false;
      if (!err || err.message !== "cancel") setNotice(err.message);
      render();
      return;
    }
    const input = {
      studentId: student.id,
      itemId,
      placeOk: true,
      placeId: where.placeId,
      placeName: where.placeName,
      photo: shot,
      code: code(),
      requestId: uid("host"),
    };
    busy = false;
    commit(item.kind === "hosted" ? "hosted" : "presence", input);
  }

  async function onWitness(itemId) {
    if (busy) return;
    const tap = Object.values(state.taps).find((entry) => entry.itemId === itemId);
    const typed = (document.getElementById(`code-${itemId}`) || {}).value || "";
    const item = rules.itemById(state, itemId);
    const student = you();
    if (!tap || !item) return;
    busy = true;
    render();
    const where = await locate(rules.fences(item, state, rules.person(tap.studentId), new Date()));
    if (!where.ok) {
      busy = false;
      setNotice(where.error);
      render();
      return;
    }
    let shot;
    try {
      shot = await takePhoto();
    } catch (err) {
      busy = false;
      if (!err || err.message !== "cancel") setNotice(err.message);
      render();
      return;
    }
    busy = false;
    commit("witness", {
      studentId: tap.studentId,
      itemId,
      code: typed.trim(),
      placeOk: true,
      placeId: where.placeId,
      photo: shot,
    });
  }

  async function onHost(requestId) {
    if (busy) return;
    const request = state.hostQueue.find((entry) => entry.id === requestId);
    if (!request) return;
    const item = rules.itemById(state, request.itemId);
    busy = true;
    render();
    const where = await locate(rules.fences(item, state, rules.person(request.studentId), new Date()));
    if (!where.ok) {
      busy = false;
      setNotice(where.error);
      render();
      return;
    }
    busy = false;
    commit("host", {
      requestId,
      placeOk: true,
      placeId: where.placeId,
    });
  }

  function liveTap(itemId) {
    const now = Date.now();
    return Object.values(state.taps).find((entry) => entry.itemId === itemId && entry.expires > now) || null;
  }

  function card(item, options) {
    const student = you();
    const now = new Date();
    const open = rules.openness(state, item, student, now, world);
    const votes = rules.voteCount(state, item.id);
    const voted = rules.hasVote(state, item.id, student.id);
    const tap = liveTap(item.id);
    const waiting = state.hostQueue.find((entry) => entry.itemId === item.id && entry.studentId === student.id && entry.expires > Date.now());
    const mine = student.id === (tap && tap.studentId);
    const author = item.authorId ? rules.person(item.authorId) : null;
    const sealed = item.hidden && !rules.isPublic(state, item);
    const voting = options.mode === "vote";
    const finishing = options.mode === "finish";
    const canVote = voting && rules.isStudent(student.id) && !sealed && !(item.proposed && item.authorId === student.id);
    const showCheckin = finishing && open.open && rules.isStudent(student.id) && !item.proposed && !waiting && !tap;
    const already = finishing && !item.proposed && finishedItem(student.id, item.id);

    return h(
      "article",
      { class: `card${options.top ? " top" : ""}${sealed ? " sealed" : ""}${already ? " done" : ""}` },
      h(
        "div",
        { class: "card-top" },
        h(
          "div",
          {},
          options.rank ? h("p", { class: "rank" }, `No. ${options.rank}`) : null,
          h(
            "p",
            { class: "meta" },
            [rules.categoryName(item), placeLabel(item), `${rules.pointsOf(item)} pts`, item.proposed ? "On the ballot" : item.season || null]
              .filter(Boolean)
              .join(" · "),
          ),
          h("h2", {}, item.title),
        ),
        canVote
          ? h(
              "button",
              { type: "button", class: voted ? "" : "ghost", "data-action": "vote", "data-id": item.id, "aria-pressed": voted ? "true" : "false" },
              voted ? "Withdraw" : "Vote",
            )
          : null,
      ),
      voting ? h("p", { class: "points" }, votes === 1 ? "1 vote" : `${votes} votes`) : null,
      h("p", { class: "fine" }, item.rule),
      finishing || !voting ? h("p", { class: "method" }, rules.methodLabel(item)) : null,
      author ? h("p", { class: "author" }, `Proposed by ${author.name}`) : null,
      finishing && !already ? h("p", { class: "reason" }, open.reason) : null,
      finishing && mine
        ? h(
            "div",
            {},
            h("p", { class: "fine" }, "The other phone has a minute to type this. Then it has to be here, with its own live photo."),
            h("p", { class: "code" }, tap.code),
            h("p", { class: "fine", "data-expires": String(tap.expires) }, "Code is live"),
          )
        : null,
      finishing && tap && !mine && rules.isStudent(student.id)
        ? h(
            "div",
            {},
            h("p", { class: "fine" }, `${rules.person(tap.studentId).name} is on site. Enter the code from their phone if you are there too.`),
            h("div", { class: "inline" }, h("input", { id: `code-${item.id}`, inputmode: "numeric", maxlength: "6", autocomplete: "off", "aria-label": "Six digit code" })),
            h(
              "div",
              { class: "actions" },
              h("button", { type: "button", "data-action": "witness", "data-id": item.id, disabled: busy ? "true" : null }, "I'm here too"),
            ),
          )
        : null,
      finishing && waiting ? h("p", { class: "reason" }, "Waiting for the host, who has to be at the place.") : null,
      already ? h("p", { class: "reason" }, witnessed(student.id, item.id)) : null,
      finishing && !already && !item.proposed
        ? h(
            "div",
            { class: "demo" },
            h("input", {
              id: `place-${item.id}`,
              name: "placeName",
              placeholder: "Name the person",
              maxlength: "80",
              "aria-label": `Person for ${item.title}`,
            }),
            h("button", { type: "button", "data-action": "demo", "data-id": item.id }, "Enter it"),
          )
        : null,
      showCheckin
        ? h(
            "div",
            { class: "actions" },
            h(
              "button",
              { type: "button", "data-action": "checkin", "data-id": item.id, disabled: busy ? "true" : null },
              busy ? "Checking the place…" : item.kind === "hosted" ? "Check in and ask the host" : "Check in here",
            ),
          )
        : null,
    );
  }

  function proofCard(proof) {
    const item = rules.itemById(state, proof.itemId);
    const student = rules.person(proof.studentId);
    const other = rules.person(proof.witnessId || proof.hostId);
    const colleges = [...new Set(proof.challenges.map((entry) => entry.college))];
    const youStudent = you();
    const involved = proof.studentId === youStudent.id || proof.witnessId === youStudent.id;
    const canChallenge = rules.isStudent(youStudent.id) && !involved && proof.status === "pending" && !proof.challenges.some((entry) => entry.studentId === youStudent.id);
    const left = proof.challengeUntil - Date.now();
    return h(
      "article",
      { class: `card${proof.status === "pending" ? " pending" : ""}` },
      h("p", { class: "meta" }, proof.demo ? "Entered for the record" : proof.status === "pending" ? "Waiting on other colleges" : "Struck"),
      h("h2", {}, item ? item.title : "An item"),
      h(
        "p",
        { class: "fine" },
        `${student ? student.name : "A student"}${other ? ` · ${other.name}` : ""} · ${proof.placeName}`,
      ),
      proof.status === "pending"
        ? h(
            "p",
            { class: "reason" },
            colleges.length
              ? `${colleges.join(" and ")} challenged. ${colleges.length} of 2 colleges.`
              : `Counts in ${formatLeft(left)} unless two colleges challenge it.`,
          )
        : proof.status === "rejected"
          ? h("p", { class: "reason" }, `Challenged by ${colleges.join(" and ")}. Both people have one fewer challenge left.`)
          : h("p", { class: "reason" }, proof.demo ? "Entered for the demonstration. The points are on the college." : "Counted."),
      h("div", { class: "photos" }, photo(proof.photo, "Live check-in photo"), photo(proof.witnessPhoto, "Witness photo")),
      canChallenge
        ? h(
            "div",
            { class: "actions" },
            h("button", { type: "button", class: "ghost", "data-action": "challenge", "data-id": proof.id }, "Challenge"),
          )
        : null,
    );
  }

  function formatLeft(ms) {
    if (ms <= 0) return "under a minute";
    const hours = Math.floor(ms / 3600000);
    const minutes = Math.floor((ms % 3600000) / 60000);
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${Math.max(minutes, 1)}m`;
  }

  function crest() {
    return h("img", { class: "crest", src: "/logo.png", alt: "" });
  }

  function siteHeader() {
    const brand = h(
      "a",
      { class: "brand", href: me && me.college ? "#standings" : "/" },
      crest(),
      h("span", { class: "brand-text" }, h("span", { class: "brand-kicker" }, "Yale College"), h("span", { class: "brand-name" }, "The Canon")),
    );
    return h("header", { class: "site-header" }, brand, me ? identity() : null);
  }

  function renderGate() {
    const params = new URLSearchParams(location.search);
    const problem = authErrors[params.get("error")] || "";
    mount(
      siteHeader(),
      h("div", { class: "sheet arrive gate" },
      h("img", { class: "gate-crest", src: "/logo.png", alt: "" }),
      h("p", { class: "mark" }, "Lux et Veritas"),
      h("h1", {}, "The Canon"),
      h("div", { class: "gate-ornament", "aria-hidden": "true" }),
      h("p", { class: "lede" }, "For students of the fourteen residential colleges."),
      h(
        "p",
        { class: "rule" },
        "Sign in with your NetID on Yale's own page. This book never sees your password. For a demonstration, enter with your name. No NetID is required, and you can propose, vote, and finish.",
      ),
      problem ? h("p", { class: "notice", role: "status" }, problem) : null,
      banner(),
      h(
        "div",
        { class: "gate-actions" },
        h("a", { class: "enter", href: "/auth/login" }, "Enter with your NetID"),
        h("button", { type: "button", class: "ghost enter", "data-action": "manual" }, "Enter for the demonstration"),
      ),
      showManual
        ? h(
            "form",
            { id: "signup", class: "signup" },
            field("signup-name", "Name", h("input", { name: "name", autocomplete: "name", required: "true", maxlength: "70" })),
            h("button", { type: "submit" }, "Enter the book"),
          )
        : null,
      ),
    );
  }

  function renderCollege() {
    mount(
      siteHeader(),
      h("div", { class: "sheet arrive" },
      h("p", { class: "mark" }, me.name),
      h("h1", {}, "Your college"),
      h("p", { class: "lede" }, "The book keeps one residential college for you."),
      banner(),
      h(
        "div",
        { class: "colleges" },
        window.CANON.colleges.map((college) =>
          h("button", { type: "button", "data-action": "college", "data-id": college.name }, college.name),
        ),
      ),
      ),
    );
  }

  const PAGES = [
    ["standings", "Standings"],
    ["profile", "Profile"],
    ["vote", "Vote"],
    ["propose", "Propose"],
    ["finish", "Finish"],
  ];

  function page() {
    const name = (location.hash || "#standings").slice(1).split("/")[0];
    return PAGES.some(([id]) => id === name) ? name : "standings";
  }

  function earned(studentId) {
    return state.proofs
      .filter((proof) => proof.status === "counted" && proof.studentId === studentId)
      .reduce((sum, proof) => sum + rules.pointsOf(rules.itemById(state, proof.itemId)), 0);
  }

  function finishedItem(studentId, itemId) {
    return state.proofs.some((proof) => proof.status === "counted" && proof.studentId === studentId && proof.itemId === itemId);
  }

  function witnessed(studentId, itemId) {
    const proof = state.proofs.find((entry) => entry.status === "counted" && entry.studentId === studentId && entry.itemId === itemId);
    return proof && proof.placeName ? `Completed · ${proof.placeName}` : "Completed";
  }

  function identity() {
    const student = you();
    const points = state ? earned(student.id) : 0;
    const detail = student.college
      ? `${student.college} · ${points} ${points === 1 ? "point" : "points"}`
      : "College not chosen";
    return h(
      "a",
      { class: "identity", href: student.college ? "#profile" : "#standings" },
      h("span", { class: "identity-name" }, student.name),
      h("span", { class: "identity-meta" }, detail),
    );
  }

  function challengesLeft(student) {
    const left = rules.standingOf(state, student.id);
    if (left <= 0) return "No challenges left. A finish does not count.";
    const noun = left === 1 ? "challenge" : "challenges";
    return `${left} ${noun} left. Two colleges can uphold one, and it costs a challenge. At zero, a finish does not count.`;
  }

  function nav() {
    const current = page();
    return h(
      "nav",
      { class: "nav" },
      PAGES.map(([id, label]) => h("a", { href: `#${id}`, class: current === id ? "on" : "" }, label)),
      h("button", { type: "button", class: "nav-out", "data-action": "signout" }, "Sign out"),
    );
  }

  function confirmBar() {
    return h(
      "div",
      { class: "confirm", role: "group" },
      h("p", {}, "Sign out and return to the gate?"),
      h("button", { type: "button", "data-action": "confirm-out" }, "Sign out"),
      h("button", { type: "button", class: "ghost", "data-action": "stay" }, "Stay"),
    );
  }

  function frame(title, lede) {
    const enter = page() !== painted;
    painted = page();
    const nodes = [
      h("h1", { class: "page" }, title),
      lede ? h("p", { class: "lede" }, lede) : null,
      banner(),
    ];
    for (let i = 2; i < arguments.length; i += 1) {
      const child = arguments[i];
      if (Array.isArray(child)) nodes.push(...child);
      else nodes.push(child);
    }
    mount(siteHeader(), nav(), confirmOut ? confirmBar() : null, h("div", { class: enter ? "sheet arrive" : "sheet" }, nodes));
  }

  function passes(item, which) {
    const bag = filters[which];
    const q = bag.find.trim().toLowerCase();
    if (q && !`${item.title} ${item.rule}`.toLowerCase().includes(q)) return false;
    if (bag.section && item.category !== bag.section) return false;
    if (bag.difficulty && String(rules.pointsOf(item)) !== bag.difficulty) return false;
    const votes = rules.voteCount(state, item.id);
    if (bag.votes === "0" && votes !== 0) return false;
    if (bag.votes === "1" && votes < 1) return false;
    if (bag.votes === "3" && votes < 3) return false;
    return true;
  }

  function filterBar(which) {
    const bag = filters[which];
    const section = h("select", { name: "section", "data-list": which, "aria-label": "Section" });
    section.append(h("option", { value: "" }, "Every section"));
    for (const category of window.CANON.categories) section.append(h("option", { value: category.id }, category.name));
    section.value = bag.section;
    const difficulty = h("select", { name: "difficulty", "data-list": which, "aria-label": "Difficulty" });
    difficulty.append(h("option", { value: "" }, "Every difficulty"));
    for (const level of window.CANON.difficulties) {
      difficulty.append(h("option", { value: String(level.points) }, `${level.label}, ${level.points}`));
    }
    difficulty.value = bag.difficulty;
    const votes = h("select", { name: "votes", "data-list": which, "aria-label": "Votes" });
    for (const [value, label] of [
      ["", "Any votes"],
      ["0", "No votes yet"],
      ["1", "At least 1 vote"],
      ["3", "At least 3 votes"],
    ]) votes.append(h("option", { value }, label));
    votes.value = bag.votes;
    return h(
      "div",
      { class: "filters" },
      h("input", {
        name: "find",
        "data-list": which,
        placeholder: "Search tasks",
        value: bag.find,
        "aria-label": "Search tasks",
      }),
      section,
      difficulty,
      votes,
    );
  }

  function grouped(items, mode) {
    return window.CANON.categories
      .map((category) => {
        const rows = items.filter((item) => item.category === category.id);
        if (!rows.length) return null;
        return section(
          category.name,
          rows.map((item) => card(item, { mode })),
        );
      })
      .filter(Boolean);
  }

  function render() {
    if (!me) {
      renderGate();
      return;
    }
    if (!me.college) {
      renderCollege();
      return;
    }
    if (!location.hash) {
      location.replace("#standings");
      return;
    }
    const student = you();
    state = rules.prepare(state, new Date());
    const current = page();
    if (current === "profile") renderProfile(student);
    else if (current === "vote") renderVote(student);
    else if (current === "propose") renderPropose(student);
    else if (current === "finish") renderFinish(student);
    else renderStandings(student);
  }

  function renderStandings(student) {
    const scoreList = rules
      .scores(state)
      .map(([college, score]) => ({ college, score }))
      .sort((a, b) => b.score - a.score || a.college.localeCompare(b.college));
    const best = scoreList[0] ? scoreList[0].score : 0;
    const leaders = scoreList.filter((row) => row.score === best && best > 0).map((row) => row.college);
    const lead =
      leaders.length === 0
        ? "No finishes have been counted yet."
          : leaders.length === 1
            ? `${leaders[0]} leads with ${best}.`
            : leaders.length > 3
              ? `Several colleges lead with ${best}.`
              : `${leaders.join(" and ")} lead with ${best}.`;
    frame(
      "Standings",
      "Counted finishes, weighted by how hard the task is.",
      h("p", { class: "board-lead" }, lead),
      h(
        "ol",
        { class: "board" },
        scoreList.map((row, index) => {
          const width = best > 0 && row.score > 0 ? Math.max(6, Math.round((row.score / best) * 100)) : 0;
          const place = row.score <= 0 ? "" : index === 0 ? " place-1" : index === 1 ? " place-2" : index === 2 ? " place-3" : "";
          return h(
            "li",
            { class: `board-row${row.college === student.college ? " mine" : ""}${place}` },
            h("span", { class: "board-rank" }, String(index + 1)),
            h(
              "span",
              { class: "board-name" },
              row.college,
              row.college === student.college ? h("span", { class: "board-you" }, "Your college") : null,
            ),
            h("span", { class: "board-track" }, h("span", { class: "board-fill", style: `width:${width}%` })),
            h("span", { class: "board-score" }, String(row.score)),
          );
        }),
      ),
      h("p", { class: "fine center" }, "A modest task is 2. A marked task is 3. A severe task is 5. A rare task is 8."),
    );
  }

  function renderProfile(student) {
    const mine = state.proofs.filter((proof) => proof.studentId === student.id || proof.witnessId === student.id || proof.hostId === student.id);
    const done = mine.filter((proof) => proof.status === "counted" && proof.studentId === student.id);
    const pending = mine.filter((proof) => proof.status === "pending");
    const struck = mine.filter((proof) => proof.status === "rejected");
    const tasks = rules.book(state).filter((item) => rules.isPublic(state, item));
    const complete = tasks.filter((item) => finishedItem(student.id, item.id)).length;
    frame(
      student.name,
      challengesLeft(student),
      h("p", { class: "rule" }, `${complete} of ${tasks.length} tasks in the book are finished.`),
      done.length ? section("Finished", done.map(proofCard)) : section("Finished", h("p", { class: "fine" }, "Nothing counted yet.")),
      pending.length ? section("Waiting out the day", pending.map(proofCard)) : null,
      struck.length ? section("Struck", struck.map(proofCard)) : null,
    );
  }

  function renderVote() {
    const now = new Date();
    const top = rules.topList(state);
    const topIds = new Set(top.map((item) => item.id));
    const open = rules.rankable(state).filter((item) => !(item.hidden && !rules.isPublic(state, item)) && passes(item, "vote"));
    const narrowed = filters.vote.find || filters.vote.section || filters.vote.difficulty || filters.vote.votes;
    frame(
      "This week",
      `${rules.nextResetLabel(now)} One vote on each task, except your own proposal. The five with the most votes are the top.`,
      filterBar("vote"),
      narrowed
        ? open.length
          ? grouped(open, "vote")
          : h("p", { class: "fine" }, "Nothing matches.")
        : [
            section(
              "The top",
              top.length
                ? top.map((item, index) => card(item, { mode: "vote", top: true, rank: index + 1 }))
                : h("p", { class: "fine" }, "No votes yet."),
            ),
            grouped(
              open.filter((item) => !topIds.has(item.id)),
              "vote",
            ),
          ],
      state.lastCrown && state.lastCrown.titles.length
        ? section("Last week on top", h("p", { class: "fine" }, state.lastCrown.titles.join(" · ")))
        : null,
    );
  }

  function renderPropose(student) {
    const mine = (state.suggestions || []).filter((item) => item.authorId === student.id);
    const used = mine.filter((item) => item.proposedWeek === state.weekKey).length;
    const left = Math.max(0, 5 - used);
    frame(
      "Propose",
      "Five proposals a week. If one is still in the top five when the votes clear, it joins the book.",
      h("p", { class: "fine center" }, left === 0 ? "Five proposals are already on the ballot this week." : `${left} of 5 left this week.`),
      mine.length ? section("Your proposals", mine.map((item) => card({ ...item, proposed: true }, { mode: "vote" }))) : null,
      left > 0 ? proposeForm() : null,
    );
  }

  function renderFinish(student) {
    const pending = state.proofs.filter((proof) => proof.status === "pending");
    const hostJobs = state.hostQueue.filter((entry) => {
      const item = rules.itemById(state, entry.itemId);
      return item && rules.appointed(state, item, student.id) && entry.expires > Date.now();
    });
    const tasks = rules.book(state).filter((item) => passes(item, "finish"));
    const completed = tasks.filter((item) => finishedItem(student.id, item.id));
    const openTasks = tasks.filter((item) => !finishedItem(student.id, item.id));
    frame(
      "Finish",
      "Name the person and enter the task. This demonstration skips the camera, the map, and the second phone.",
      hostJobs.length
        ? section(
            "Waiting on you",
            hostJobs.map((entry) => {
              const owner = rules.person(entry.studentId);
              const item = rules.itemById(state, entry.itemId);
              return h(
                "article",
                { class: "card pending" },
                h("h2", {}, item ? item.title : "A request"),
                h("p", { class: "fine" }, `${owner ? owner.name : "A student"} is at ${entry.placeName}. Mark them only if you are there too.`),
                photo(entry.photo, "Student check-in photo"),
                h(
                  "div",
                  { class: "actions" },
                  h("button", { type: "button", "data-action": "host", "data-id": entry.id, disabled: busy ? "true" : null }, "I'm at the place"),
                ),
              );
            }),
          )
        : null,
      pending.length ? section("Open to a challenge", pending.map(proofCard)) : null,
      completed.length
        ? section(
            "Completed",
            completed.map((item) => card(item, { mode: "finish" })),
            "done",
          )
        : null,
      filterBar("finish"),
      openTasks.length ? grouped(openTasks, "finish") : completed.length ? null : h("p", { class: "fine" }, "Nothing matches."),
    );
  }

  function section(kicker, body, extra) {
    return h("section", { class: extra || "" }, h("p", { class: "mark" }, kicker), body);
  }

  function placeLabel(item) {
    if (item.placeName) return item.placeName;
    const place = item.placeId && window.CANON.places[item.placeId];
    return place ? place.name : "";
  }

  function proposeForm() {
    const places = Object.entries(window.CANON.places).sort((a, b) => a[1].name.localeCompare(b[1].name));
    return h(
      "form",
      { id: "propose" },
      field("title", "Title", h("input", { name: "title", maxlength: "80", required: "true" })),
      field("rule", "What counts", h("textarea", { name: "rule", maxlength: "200", required: "true" })),
      field(
        "category",
        "Section",
        select(
          "category",
          window.CANON.categories.map((category) => [category.id, category.name]),
        ),
      ),
      field(
        "difficulty",
        "Difficulty",
        select(
          "difficulty",
          window.CANON.difficulties.map((level) => [level.id, `${level.label}, ${level.points} points`]),
        ),
      ),
      field(
        "place",
        "Campus place",
        h("input", {
          name: "placeName",
          maxlength: "80",
          required: "true",
          placeholder: "Type a campus place",
          list: "campus-places",
          autocomplete: "off",
        }),
      ),
      h(
        "datalist",
        { id: "campus-places" },
        places.map(([, place]) => h("option", { value: place.name })),
      ),
      field(
        "window",
        "When it can be finished",
        select(
          "windowId",
          window.CANON.windowChoices.map((choice) => [choice.id, choice.label]),
        ),
      ),
      field(
        "kind",
        "Who confirms it",
        select("kind", [
          ["presence", "A second student, on site"],
          ["hosted", "A host, on site"],
        ]),
      ),
        h(
          "div",
          { class: "field", id: "host-field", hidden: "true" },
          h("label", { for: "hostId" }, "Host"),
          select(
            "hostId",
            window.CANON.hosts.map((host) => [host.id, host.name]),
          ),
        ),
        h("div", { class: "actions" }, h("button", { type: "submit" }, "Put it on the ballot")),
    );
  }

  function field(id, label, control) {
    control.id = id === "rule" ? "rule" : control.getAttribute("name");
    const labelFor = control.getAttribute("name");
    return h("div", { class: "field" }, h("label", { for: labelFor }, label), control);
  }

  function select(name, pairs) {
    const node = h("select", { name, id: name });
    for (const [value, label] of pairs) node.append(h("option", { value }, label));
    return node;
  }

  app.addEventListener("click", (event) => {
    const button = event.target.closest("[data-action]");
    if (!button || button.disabled) return;
    const id = button.getAttribute("data-id");
    const action = button.getAttribute("data-action");
    if (action === "vote") commit("vote", { itemId: id });
    if (action === "checkin") onCheckin(id);
    if (action === "witness") onWitness(id);
    if (action === "challenge") commit("challenge", { proofId: id });
    if (action === "host") onHost(id);
    if (action === "college") commit("college", { college: id });
    if (action === "manual") {
      showManual = true;
      setNotice("");
      renderGate();
    }
    if (action === "demo") {
      const place = document.getElementById(`place-${id}`);
      commit("demo", { itemId: id, placeName: place ? place.value : "" });
    }
    if (action === "signout") {
      confirmOut = true;
      render();
    }
    if (action === "stay") {
      confirmOut = false;
      render();
    }
    if (action === "confirm-out") location.assign("/auth/logout");
  });

  app.addEventListener("input", (event) => {
    if (event.target.name !== "find") return;
    const which = event.target.getAttribute("data-list");
    if (!filters[which]) return;
    filters[which].find = event.target.value;
    const start = event.target.selectionStart;
    render();
    const again = document.querySelector(`input[name="find"][data-list="${which}"]`);
    if (again) {
      again.focus();
      if (start != null) again.setSelectionRange(start, start);
    }
  });

  app.addEventListener("change", (event) => {
    const which = event.target.getAttribute("data-list");
    if (which && filters[which] && ["section", "difficulty", "votes"].includes(event.target.name)) {
      filters[which][event.target.name] = event.target.value;
      render();
      return;
    }
    if (event.target.name === "kind") {
      const host = document.getElementById("host-field");
      if (host) host.hidden = event.target.value !== "hosted";
    }
  });

  app.addEventListener("submit", (event) => {
    if (event.target.id === "signup") {
      event.preventDefault();
      const data = new FormData(event.target);
      fetch("/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: data.get("name") }),
      })
        .then((response) => response.json())
        .then((result) => {
          if (!result.ok) {
            setNotice(result.error || "The register could not be signed.");
            renderGate();
            return;
          }
          me = result.user;
          state = result.state;
          showManual = false;
          setNotice("");
          render();
        })
        .catch(() => {
          setNotice("The register could not be signed.");
          renderGate();
        });
      return;
    }
    if (event.target.id !== "propose") return;
    event.preventDefault();
    const data = new FormData(event.target);
    commit("suggest", {
      title: data.get("title"),
      rule: data.get("rule"),
      placeName: data.get("placeName"),
      windowId: data.get("windowId"),
      kind: data.get("kind"),
      hostId: data.get("hostId"),
      category: data.get("category"),
      difficulty: data.get("difficulty"),
    });
  });

  setInterval(() => {
    const camera = document.getElementById("camera");
    for (const node of document.querySelectorAll("[data-expires]")) {
      const left = Number(node.getAttribute("data-expires")) - Date.now();
      node.textContent = left > 0 ? `Expires in ${Math.ceil(left / 1000)}s` : "Expired";
    }
    if (!state || !me || saving) return;
    if (camera && !camera.hidden) return;
    if (document.activeElement && ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName)) return;
    const next = rules.prepare(state, new Date());
    const before = `${state.weekKey}|${state.proofs.map((proof) => proof.status).join()}|${Object.keys(state.taps).length}|${state.hostQueue.length}`;
    const after = `${next.weekKey}|${next.proofs.map((proof) => proof.status).join()}|${Object.keys(next.taps).length}|${next.hostQueue.length}`;
    if (before !== after) commit("resolve", {});
  }, 1000);

  window.addEventListener("hashchange", () => {
    notice = "";
    noticePage = "";
    clearTimeout(noticeTimer);
    render();
  });

  fetch("/api/session")
    .then((response) => response.json())
    .then((data) => {
      me = data.user;
      state = data.state;
      render();
    })
    .catch(() => {
      setNotice("Open this book from its server. A file on its own cannot sign you in.");
      renderGate();
    });

  fetch("https://api.open-meteo.com/v1/forecast?latitude=41.31&longitude=-72.928&current=snowfall,weather_code")
    .then((res) => res.json())
    .then((data) => {
      const code = data.current && data.current.weather_code;
      const snowfall = data.current && data.current.snowfall;
      world = { snowing: (snowfall || 0) > 0 || [71, 73, 75, 77, 85, 86].includes(code) };
      if (document.getElementById("signup")) return;
      render();
    })
    .catch(() => {
      world = { snowing: null, failed: true };
      render();
    });
})();
