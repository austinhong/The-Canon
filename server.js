const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const ROOT = __dirname;
const DATA = path.join(ROOT, "data");
const PORT = Number(process.env.PORT) || 8765;
const CAS = "https://secure.its.yale.edu/cas";
const FILES = new Set(["/index.html", "/app.js", "/rules.js", "/canon.js", "/styles.css"]);
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};

const { CANON, CanonRules: rules } = loadRules();
const sessions = new Map();
let weather = { snowing: null, at: 0 };

fs.mkdirSync(DATA, { recursive: true });

function loadRules() {
  const context = { console, Intl, Date, Math, structuredClone, globalThis: null };
  context.globalThis = context;
  const vm = require("node:vm");
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(ROOT, "canon.js"), "utf8"), context);
  vm.runInContext(fs.readFileSync(path.join(ROOT, "rules.js"), "utf8"), context);
  return context;
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA, file), "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  const target = path.join(DATA, file);
  const temporary = `${target}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value));
  fs.renameSync(temporary, target);
}

function loadBook() {
  const state = readJson("book.json", null) || rules.blankState(new Date());
  state.people = state.people || [];
  state.appointments = readJson("hosts.json", state.appointments || {});
  state.standing = state.standing || {};
  return state;
}

function saveBook(state) {
  writeJson("book.json", state);
}

function originOf(req) {
  const forwarded = req.headers["x-forwarded-proto"];
  const proto = forwarded ? String(forwarded).split(",")[0].trim() : "http";
  return `${proto}://${req.headers.host}`;
}

function serviceUrl(req) {
  return `${originOf(req)}/auth/callback`;
}

function cookieSid(req) {
  const header = req.headers.cookie || "";
  const match = header.match(/(?:^|;\s*)canon=([^;]+)/);
  return match ? match[1] : "";
}

function userFor(req) {
  const sid = cookieSid(req);
  const session = sessions.get(sid);
  if (!session || session.expires < Date.now()) {
    if (sid) sessions.delete(sid);
    return null;
  }
  return session.user;
}

function send(res, status, body, headers) {
  res.writeHead(status, Object.assign({ "Cache-Control": "no-store" }, headers));
  res.end(body);
}

function redirect(res, location, sid) {
  const headers = { Location: location };
  if (sid) headers["Set-Cookie"] = `canon=${sid}; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800`;
  if (sid === "") headers["Set-Cookie"] = "canon=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0";
  send(res, 302, "", headers);
}

function json(res, status, value, extra) {
  send(res, status, JSON.stringify(value), Object.assign({ "Content-Type": "application/json; charset=utf-8" }, extra));
}

function startSession(person) {
  const sid = crypto.randomBytes(24).toString("hex");
  sessions.set(sid, { user: { id: person.id, name: person.name }, expires: Date.now() + 8 * 60 * 60 * 1000 });
  return sid;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => {
      chunks.push(chunk);
      if (Buffer.concat(chunks).length > 2_000_000) {
        reject(new Error("too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {});
      } catch {
        reject(new Error("bad json"));
      }
    });
    req.on("error", reject);
  });
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return false;
  return origin === originOf(req);
}

function readCas(xml) {
  if (!xml.includes("authenticationSuccess")) {
    const denied = /not authorized|unauthorized|unregistered|application/i.test(xml);
    return { ok: false, error: denied ? "denied" : "ticket" };
  }
  const user = (xml.match(/<(?:cas:)?user>([^<]+)<\/(?:cas:)?user>/) || [])[1];
  const netid = user ? user.trim() : "";
  if (!/^[A-Za-z][A-Za-z0-9]{1,30}$/.test(netid)) return { ok: false, error: "ticket" };
  const values = [...xml.matchAll(/<(?:cas:)?([A-Za-z0-9]+)>([^<]*)<\/(?:cas:)?\1>/g)].map((match) => match[2].trim());
  const blob = values.join("\n").toLowerCase();
  const student = /\bstudent\b|\bundergraduate\b|yale college/.test(blob);
  if (!student) return { ok: false, error: "student" };
  const named = xml.match(/<(?:cas:)?(?:displayName|cn)>([^<]+)<\/(?:cas:)?(?:displayName|cn)>/i);
  const name = named ? named[1].trim() : netid;
  return { ok: true, netid, name };
}

async function validateTicket(service, ticket) {
  const bases = [`${CAS}/p3/serviceValidate`, `${CAS}/serviceValidate`];
  let xml = "";
  for (const base of bases) {
    const url = `${base}?service=${encodeURIComponent(service)}&ticket=${encodeURIComponent(ticket)}`;
    const response = await fetch(url);
    xml = await response.text();
    if (xml.includes("cas:")) return xml;
  }
  return xml;
}

async function campusWeather() {
  if (Date.now() - weather.at < 10 * 60 * 1000 && weather.snowing != null) return weather;
  try {
    const response = await fetch(
      "https://api.open-meteo.com/v1/forecast?latitude=41.31&longitude=-72.928&current=snowfall,weather_code",
    );
    const data = await response.json();
    const code = data.current && data.current.weather_code;
    const snowfall = data.current && data.current.snowfall;
    weather = { snowing: (snowfall || 0) > 0 || [71, 73, 75, 77, 85, 86].includes(code), at: Date.now() };
  } catch {
    weather = { snowing: null, failed: true, at: Date.now() };
  }
  return weather;
}

function demonstrationId(state, name) {
  const same = state.people.find(
    (member) => String(member.id).startsWith("demo-") && member.name.toLowerCase() === name.toLowerCase(),
  );
  if (same) return same.id;
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 20) || "guest";
  let id = `demo-${slug}`;
  let n = 2;
  while (state.people.some((member) => member.id === id)) {
    id = `demo-${slug}-${n}`;
    n += 1;
  }
  return id;
}

function ensurePerson(state, profile) {
  let person = state.people.find((member) => member.id === profile.id);
  if (!person) {
    person = { id: profile.id, name: profile.name, college: "", role: "student", year: "student" };
    state.people.push(person);
    state.standing[profile.id] = rules.STANDING_START;
  } else if (profile.name && person.name === person.id) {
    person.name = profile.name;
  }
  return person;
}

function publicUser(person) {
  if (!person) return null;
  return { id: person.id, name: person.name, college: person.college || "" };
}

async function act(state, user, body) {
  const person = ensurePerson(state, user);
  const now = new Date();
  const world = await campusWeather();
  if (body.action === "college") {
    const college = CANON.colleges.find((entry) => entry.name === body.college);
    if (!college) return { ok: false, error: "That is not one of the fourteen residential colleges." };
    if (person.college) return { ok: false, error: "Your college is already entered." };
    person.college = college.name;
    return { ok: true, state, message: `${college.name} College.` };
  }
  if (body.action === "resolve") return { ok: true, state: rules.prepare(state, now) };
  if (!person.college) return { ok: false, error: "Choose your residential college first." };

  if (body.action === "vote") return rules.vote(state, user.id, body.itemId, now);
  if (body.action === "suggest") {
    return rules.suggest(
      state,
      {
        studentId: user.id,
        title: body.title,
        rule: body.rule,
        placeId: body.placeId,
        placeName: body.placeName,
        windowId: body.windowId,
        kind: body.kind,
        hostId: body.hostId,
        category: body.category,
        difficulty: body.difficulty,
      },
      now,
    );
  }
  if (body.action === "presence" || body.action === "hosted") {
    const input = {
      studentId: user.id,
      itemId: body.itemId,
      placeOk: body.placeOk === true,
      placeId: body.placeId,
      placeName: body.placeName,
      photo: body.photo,
      code: body.code,
      requestId: body.requestId || `host-${crypto.randomBytes(4).toString("hex")}`,
    };
    return body.action === "hosted"
      ? rules.beginHosted(state, input, now, world)
      : rules.beginPresence(state, input, now, world);
  }
  if (body.action === "witness") {
    return rules.confirmWitness(
      state,
      {
        studentId: body.studentId,
        witnessId: user.id,
        itemId: body.itemId,
        code: body.code,
        placeOk: body.placeOk === true,
        placeId: body.placeId,
        photo: body.photo,
        proofId: `proof-${crypto.randomBytes(4).toString("hex")}`,
      },
      now,
      world,
    );
  }
  if (body.action === "host") {
    return rules.confirmHost(
      state,
      {
        requestId: body.requestId,
        hostId: user.id,
        placeOk: body.placeOk === true,
        placeId: body.placeId,
        proofId: `proof-${crypto.randomBytes(4).toString("hex")}`,
      },
      now,
    );
  }
  if (body.action === "challenge") return rules.challenge(state, { studentId: user.id, proofId: body.proofId }, now);
  if (body.action === "demo") {
    return rules.demoFinish(
      state,
      {
        studentId: user.id,
        itemId: body.itemId,
        placeName: body.placeName,
        proofId: `proof-${crypto.randomBytes(4).toString("hex")}`,
      },
      now,
    );
  }
  return { ok: false, error: "Unknown action." };
}

function serveFile(res, urlPath) {
  const name = urlPath === "/" ? "/index.html" : urlPath;
  if (!FILES.has(name)) {
    send(res, 404, "Not found", { "Content-Type": "text/plain; charset=utf-8" });
    return;
  }
  const file = path.join(ROOT, name.slice(1));
  send(res, 200, fs.readFileSync(file), { "Content-Type": TYPES[path.extname(file)] });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, originOf(req));
  try {
    if (req.method === "GET" && (url.pathname === "/" || FILES.has(url.pathname))) {
      serveFile(res, url.pathname);
      return;
    }
    if (req.method === "GET" && url.pathname === "/auth/login") {
      redirect(res, `${CAS}/login?service=${encodeURIComponent(serviceUrl(req))}`);
      return;
    }
    if (req.method === "GET" && url.pathname === "/auth/logout") {
      sessions.delete(cookieSid(req));
      redirect(res, "/", "");
      return;
    }
    if (req.method === "GET" && url.pathname === "/auth/callback") {
      const ticket = url.searchParams.get("ticket") || "";
      const xml = await validateTicket(serviceUrl(req), ticket);
      const cas = readCas(xml);
      if (!cas.ok) {
        redirect(res, `/?error=${cas.error}`);
        return;
      }
      const state = loadBook();
      const person = ensurePerson(state, { id: cas.netid, name: cas.name });
      saveBook(state);
      redirect(res, "/", startSession(person));
      return;
    }
    if (req.method === "POST" && url.pathname === "/auth/signup") {
      if (!sameOrigin(req)) {
        json(res, 403, { ok: false, error: "Open the book on its own site." });
        return;
      }
      const body = await readBody(req);
      const netid = String(body.netid || "").trim().toLowerCase();
      const name = String(body.name || "").trim().replace(/\s+/g, " ");
      if (netid && !/^[a-z][a-z0-9]{1,30}$/.test(netid)) {
        json(res, 400, { ok: false, error: "Enter a NetID of letters and numbers." });
        return;
      }
      if (!/^[A-Za-z][A-Za-z .'-]{1,70}$/.test(name)) {
        json(res, 400, { ok: false, error: "Enter the name that should stand in the book." });
        return;
      }
      const state = loadBook();
      const person = ensurePerson(state, { id: netid || demonstrationId(state, name), name });
      saveBook(state);
      json(
        res,
        200,
        { ok: true, user: publicUser(person), state: person.college ? rules.prepare(state, new Date()) : null },
        { "Set-Cookie": `canon=${startSession(person)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800` },
      );
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/session") {
      const user = userFor(req);
      if (!user) {
        json(res, 200, { user: null, state: null });
        return;
      }
      const state = rules.prepare(loadBook(), new Date());
      const person = state.people.find((member) => member.id === user.id);
      json(res, 200, { user: publicUser(person), state });
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/action") {
      if (!sameOrigin(req)) {
        json(res, 403, { ok: false, error: "Open the book on its own site." });
        return;
      }
      const user = userFor(req);
      if (!user) {
        json(res, 401, { ok: false, error: "Sign in with your NetID." });
        return;
      }
      const body = await readBody(req);
      const state = loadBook();
      const result = await act(state, user, body);
      if (result.ok) saveBook(result.state);
      const person = (result.state || state).people.find((member) => member.id === user.id);
      json(res, result.ok ? 200 : 400, {
        ok: result.ok,
        error: result.error || "",
        message: result.message || "",
        state: result.ok ? result.state : undefined,
        user: publicUser(person),
      });
      return;
    }
    send(res, 404, "Not found", { "Content-Type": "text/plain; charset=utf-8" });
  } catch (error) {
    json(res, 500, { ok: false, error: "The book could not complete that." });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`The Canon is at http://127.0.0.1:${PORT}`);
});
