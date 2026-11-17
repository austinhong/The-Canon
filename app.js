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
  let busy = false;
  let saving = false;

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
      notice = result.error || "The book could not record that.";
      if (result.user) me = result.user;
      render();
      return;
    }
    state = result.state;
    me = result.user || me;
    notice = result.message || "";
    render();
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
      notice = where.error;
      render();
      return;
    }
    let shot;
    try {
      shot = await takePhoto();
    } catch (err) {
      busy = false;
      if (!err || err.message !== "cancel") notice = err.message;
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
      notice = where.error;
      render();
      return;
    }
    let shot;
    try {
      shot = await takePhoto();
    } catch (err) {
      busy = false;
      if (!err || err.message !== "cancel") notice = err.message;
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
      notice = where.error;
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
    const canVote = rules.isStudent(student.id) && !sealed && !(item.proposed && item.authorId === student.id);
    const showCheckin = open.open && rules.isStudent(student.id) && !item.proposed && !waiting && !tap;

    return h(
      "article",
      { class: `card${options.top ? " top" : ""}${item.hidden && !rules.isPublic(state, item) ? " sealed" : ""}` },
      h(
        "div",
        { class: "card-top" },
        h(
          "div",
          {},
          options.rank ? h("p", { class: "rank" }, String(options.rank)) : null,
          h("p", { class: "meta" }, [item.season || "Proposed", item.proposed ? "On the ballot" : null].filter(Boolean).join(" · ")),
          h("h2", {}, item.title),
        ),
        canVote
          ? h(
              "button",
              { type: "button", class: voted ? "" : "ghost", "data-action": "vote", "data-id": item.id, "aria-pressed": voted ? "true" : "false" },
              voted ? "Voted" : "Vote",
            )
          : null,
      ),
      h("p", { class: "fine" }, item.rule),
      h("p", { class: "method" }, rules.methodLabel(item)),
      author ? h("p", { class: "author" }, `Proposed by ${author.name}`) : null,
      h("p", { class: "reason" }, open.reason),
      mine
        ? h(
            "div",
            {},
            h("p", { class: "fine" }, "The other phone has a minute to type this. Then it has to be here, with its own live photo."),
            h("p", { class: "code" }, tap.code),
            h("p", { class: "fine", "data-expires": String(tap.expires) }, "Code is live"),
          )
        : null,
      tap && !mine && rules.isStudent(student.id)
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
      waiting ? h("p", { class: "reason" }, "Waiting for the host, who has to be at the place.") : null,
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
      h("p", { class: "meta" }, proof.status === "pending" ? "Waiting on other colleges" : "Struck"),
      h("h2", {}, item ? item.title : "An item"),
      h(
        "p",
        { class: "fine" },
        `${student ? student.name : "A student"} · ${other ? other.name : "A host"} · ${proof.placeName}`,
      ),
      proof.status === "pending"
        ? h(
            "p",
            { class: "reason" },
            colleges.length
              ? `${colleges.join(" and ")} challenged. ${colleges.length} of 2 colleges.`
              : `Counts in ${formatLeft(left)} unless two colleges challenge it.`,
          )
        : h("p", { class: "reason" }, `Challenged by ${colleges.join(" and ")}. Both people lost standing.`),
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
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "crest");
    svg.setAttribute("viewBox", "0 0 64 72");
    svg.setAttribute("aria-hidden", "true");
    svg.innerHTML =
      '<path d="M32 3 L58 14 V36 C58 52 46 64 32 69 C18 64 6 52 6 36 V14 Z" fill="none" stroke="currentColor" stroke-width="1.4"/>' +
      '<path d="M18 40 V28 H28 C34 28 38 31 38 36 C38 41 34 44 28 44 H18" fill="none" stroke="currentColor" stroke-width="1.4"/>' +
      '<path d="M18 34 H36" stroke="currentColor" stroke-width="1.4"/>';
    return svg;
  }

  function renderGate() {
    const params = new URLSearchParams(location.search);
    const problem = authErrors[params.get("error")] || "";
    mount(
      crest(),
      h("p", { class: "mark" }, "Yale College"),
      h("h1", {}, "The Canon"),
      h("p", { class: "lede" }, "For students of the fourteen residential colleges."),
      h(
        "p",
        { class: "rule" },
        "Sign in with your NetID on Yale's own page. This book never sees your password. A faculty, staff, or affiliate NetID is refused.",
      ),
      problem ? h("p", { class: "notice", role: "status" }, problem) : null,
      h("a", { class: "enter", href: "/auth/login" }, "Enter with your NetID"),
    );
  }

  function renderCollege() {
    mount(
      crest(),
      h("p", { class: "mark" }, me.name),
      h("h1", {}, "Your college"),
      h("p", { class: "lede" }, "The book keeps one residential college for this NetID."),
      notice ? h("p", { class: "notice", role: "status" }, notice) : null,
      h(
        "div",
        { class: "colleges" },
        window.CANON.colleges.map((college) =>
          h("button", { type: "button", "data-action": "college", "data-id": college.name }, college.name),
        ),
      ),
    );
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
    const student = you();
    const now = new Date();
    state = rules.prepare(state, now);
    const top = rules.topList(state);
    const topIds = new Set(top.map((item) => item.id));
    const rest = rules.book(state).filter((item) => rules.isPublic(state, item) && !topIds.has(item.id));
    const sealed = rules.book(state).filter((item) => item.hidden && !rules.isPublic(state, item));
    const ballot = state.suggestions.filter((item) => !topIds.has(item.id));
    const pending = state.proofs.filter((proof) => proof.status === "pending");
    const struck = state.proofs.filter(
      (proof) =>
        proof.status === "rejected" &&
        (proof.studentId === student.id || proof.witnessId === student.id || proof.hostId === student.id || proof.challenges.some((entry) => entry.studentId === student.id)),
    );
    const hostJobs = state.hostQueue.filter((entry) => {
      const item = rules.itemById(state, entry.itemId);
      return item && rules.appointed(state, item, student.id) && entry.expires > Date.now();
    });
    const scoreList = rules.scores(state);

    mount(
      crest(),
      h("p", { class: "mark" }, "Yale College"),
      h("h1", {}, "The Canon"),
      h("p", { class: "lede" }, "The register of the fourteen colleges."),
      h(
        "p",
        { class: "rule" },
        `The top of the book is a vote. ${rules.nextResetLabel(now)} A finish needs a live camera on site, inside the hour, and a second student's phone that has not already confirmed you ${rules.PAIR_LIMIT} times. Another two colleges may strike it within a day.`,
      ),
      h(
        "div",
        { class: "who" },
        h("span", {}, student.name),
        h("span", { class: "gold" }, student.college),
        h("span", {}, `Standing ${rules.standingOf(state, student.id)}`),
        h("a", { href: "/auth/logout" }, "Sign out"),
      ),
      notice ? h("p", { class: "notice", role: "status" }, notice) : null,
      h(
        "ul",
        { class: "scores" },
        scoreList.map(([college, score]) => h("li", {}, `${college} ${score}`)),
      ),
      section(
        "This week",
        top.length
          ? top.map((item, index) => card(item, { top: true, rank: index + 1 }))
          : h("p", { class: "fine" }, "No votes yet. The top is open."),
      ),
      pending.length ? section("Open to a challenge", pending.map(proofCard)) : null,
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
      section(
        "The book",
        rest.map((item) => card(item, {})),
      ),
      sealed.length ? section("Sealed until someone finishes one", sealed.map((item) => card(item, {}))) : null,
      ballot.length ? section("On the ballot", ballot.map((item) => card({ ...item, proposed: true }, {}))) : null,
      proposeForm(student),
      struck.length ? section("Struck", struck.map(proofCard)) : null,
      state.lastCrown && state.lastCrown.titles.length
        ? section("Last week on top", h("p", { class: "fine" }, state.lastCrown.titles.join(" · ")))
        : null,
    );
  }

  function section(kicker, body) {
    return h("section", {}, h("p", { class: "mark" }, kicker), body);
  }

  function proposeForm(student) {
    if (!rules.isStudent(student.id)) return null;
    const places = Object.entries(window.CANON.places).sort((a, b) => a[1].name.localeCompare(b[1].name));
    return section(
      "Propose",
      h(
        "form",
        { id: "propose" },
        field("title", "Title", h("input", { name: "title", maxlength: "80", required: "true" })),
        field("rule", "What counts", h("textarea", { name: "rule", maxlength: "200", required: "true" })),
        field(
          "place",
          "Campus place",
          select(
            "placeId",
            places.map(([id, place]) => [id, place.name]),
          ),
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
      ),
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
  });

  app.addEventListener("change", (event) => {
    if (event.target.name === "kind") {
      const host = document.getElementById("host-field");
      if (host) host.hidden = event.target.value !== "hosted";
    }
  });

  app.addEventListener("submit", (event) => {
    if (event.target.id !== "propose") return;
    event.preventDefault();
    const data = new FormData(event.target);
    commit("suggest", {
      title: data.get("title"),
      rule: data.get("rule"),
      placeId: data.get("placeId"),
      windowId: data.get("windowId"),
      kind: data.get("kind"),
      hostId: data.get("hostId"),
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

  fetch("/api/session")
    .then((response) => response.json())
    .then((data) => {
      me = data.user;
      state = data.state;
      render();
    })
    .catch(() => {
      notice = "Open this book from its server. A file on its own cannot sign you in.";
      renderGate();
    });

  fetch("https://api.open-meteo.com/v1/forecast?latitude=41.31&longitude=-72.928&current=snowfall,weather_code")
    .then((res) => res.json())
    .then((data) => {
      const code = data.current && data.current.weather_code;
      const snowfall = data.current && data.current.snowfall;
      world = { snowing: (snowfall || 0) > 0 || [71, 73, 75, 77, 85, 86].includes(code) };
      render();
    })
    .catch(() => {
      world = { snowing: null, failed: true };
      render();
    });
})();
