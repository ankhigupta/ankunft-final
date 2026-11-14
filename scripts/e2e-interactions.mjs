/**
 * Browser smoke test for the interactions React must handle: preset buttons, Plan / Ask / Sources tabs,
 * "Mark as done" and "Undo", the example-question chips, and the situation form.
 *
 * It drives a real headless Chrome with real mouse clicks over the DevTools protocol (no dependencies) and
 * checks the page after each click. It exists because a page that never hydrates still looks right and keeps
 * its native inputs working, so unit tests cannot see that failure.
 *
 *   npm run dev            (or: npm run build && npm start -- -p 3100)
 *   npm run test:e2e -- http://localhost:3000 http://127.0.0.1:3000
 *
 * Give it every origin you use (localhost, 127.0.0.1, the Network address). Chrome: set CHROME_PATH if it is
 * not in the usual place. Exit code 1 if any check fails.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const urls = process.argv.slice(2).length ? process.argv.slice(2) : ["http://localhost:3000"];
const CANDIDATES = [
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].filter(Boolean);
const chromePath = CANDIDATES.find((p) => existsSync(p));
if (!chromePath) {
  console.error("Chrome not found. Set CHROME_PATH to a Chrome or Chromium binary.");
  process.exit(2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function withBrowser(fn) {
  const profile = mkdtempSync(join(tmpdir(), "ankunft-e2e-"));
  const chrome = spawn(
    chromePath,
    ["--headless=new", "--remote-debugging-pipe", "--no-first-run", "--disable-gpu", "--window-size=1100,900", `--user-data-dir=${profile}`, "about:blank"],
    { stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"] },
  );
  const [toChrome, fromChrome] = [chrome.stdio[3], chrome.stdio[4]];
  let id = 0;
  let buf = "";
  const pending = new Map();
  const events = [];
  fromChrome.on("data", (d) => {
    buf += d.toString();
    let i;
    while ((i = buf.indexOf("\0")) >= 0) {
      const m = JSON.parse(buf.slice(0, i));
      buf = buf.slice(i + 1);
      if (m.id && pending.has(m.id)) {
        pending.get(m.id)(m);
        pending.delete(m.id);
      } else events.push(m);
    }
  });
  const send = (method, params = {}, sessionId) =>
    new Promise((res) => {
      const i = ++id;
      pending.set(i, res);
      toChrome.write(JSON.stringify({ id: i, method, params, sessionId }) + "\0");
    });
  try {
    const created = await send("Target.createTarget", { url: "about:blank" });
    const attached = await send("Target.attachToTarget", { targetId: created.result.targetId, flatten: true });
    const sessionId = attached.result.sessionId;
    const S = (m, p) => send(m, p, sessionId);
    await S("Runtime.enable");
    await S("Page.enable");
    await S("Log.enable");
    return await fn({ S, events });
  } finally {
    chrome.kill();
    await sleep(200);
    rmSync(profile, { recursive: true, force: true });
  }
}

async function runOrigin(url) {
  return withBrowser(async ({ S, events }) => {
    const ev = async (expr) => {
      const r = await S("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
      if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.text + " in " + expr.slice(0, 80));
      return r.result.result.value;
    };
    const results = [];
    const check = (name, ok, detail = "") => results.push({ name, ok: Boolean(ok), detail });

    // A real mouse click at the centre of the element. Also reports whether something else covers that point.
    const click = async (find) => {
      const pt = await ev(`(() => { const el = ${find}; if (!el) return null; el.scrollIntoView({ block: "center" });
        const r = el.getBoundingClientRect(); const x = r.x + r.width / 2, y = r.y + r.height / 2;
        const top = document.elementFromPoint(x, y); return { x, y, covered: !(top === el || el.contains(top)) }; })()`);
      if (!pt) return { found: false };
      for (const type of ["mouseMoved", "mousePressed", "mouseReleased"])
        await S("Input.dispatchMouseEvent", { type, x: pt.x, y: pt.y, button: "left", clickCount: 1 });
      await sleep(600);
      return { found: true, covered: pt.covered };
    };
    const byText = (sel, text) => `[...document.querySelectorAll(${JSON.stringify(sel)})].find((e) => e.textContent.trim().startsWith(${JSON.stringify(text)}))`;
    const plateTitle = () => ev(`document.querySelector(".plate h2")?.textContent ?? null`);
    const activeTab = () => ev(`document.querySelector(".tab[aria-current]")?.textContent ?? null`);

    await S("Page.navigate", { url });
    await sleep(5000);

    // 1. Hydration: React attaches its props to the DOM nodes it controls. Missing means no handler can run.
    const hydrated = await ev(`(() => { const b = document.querySelector("button.scen"); return !!b && Object.keys(b).some((k) => k.startsWith("__reactProps")); })()`);
    check("page hydrated (React handlers attached)", hydrated, hydrated ? "" : "no React props on buttons: the page rendered but never hydrated");
    if (!hydrated) return results;

    // 2. Nothing covers the controls.
    const covered = await ev(`[...document.querySelectorAll("button.scen, button.tab")].filter((b) => { const r = b.getBoundingClientRect(); const t = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return !(t === b || b.contains(t)); }).length`);
    check("no overlay covers the preset or tab buttons", covered === 0, `${covered} covered`);

    // 3. Presets.
    const presets = [
      ["Just arrived, no flat yet", async () => (await plateTitle()) !== null && (await ev(`document.querySelector("#in-arrivalDate").value`)) === "2026-11-12"],
      ["Moved in 3 days ago", async () => (await ev(`document.querySelector("#in-moveInDate").value`)) === "2026-11-11"],
      ["Moved in 20 days ago", async () => (await ev(`document.querySelector("#in-moveInDate").value`)) === "2026-10-25"],
      ["Entered without a visa", async () => (await ev(`document.querySelector(".callout-abstain")?.textContent ?? ""`)).includes("Not covered yet")],
    ];
    for (const [label, verify] of presets) {
      const r = await click(byText("button.scen", label));
      check(`preset "${label}" responds`, r.found && (await verify()) && (await ev(`!!document.querySelector(".demo-banner")`)));
    }

    // 4. "Mark as done" and "Undo".
    await click(byText("button.scen", "Moved in 3 days ago"));
    const before = await plateTitle();
    const m = await click(`document.querySelector(".plate .btn")`);
    const after = await plateTitle();
    check('"Mark as done" on the next-step plate moves the plan on', m.found && before !== after, `${before} -> ${after}`);
    const doneCount = await ev(`[...document.querySelectorAll(".group-title")].find((h) => h.textContent.startsWith("Done"))?.querySelector(".count")?.textContent ?? "0"`);
    check("the finished step appears under Done", Number(doneCount) >= 1, `Done count ${doneCount}`);
    // Only steps the person marked done have an Undo button (housing is done from the move-in date).
    await click(`[...document.querySelectorAll(".row-done")].find((r) => r.querySelector(".btn-quiet"))?.querySelector("summary")`);
    const u = await click(`document.querySelector(".row-done .btn-quiet")`);
    const afterUndo = await plateTitle();
    check('"Undo" puts the step back', u.found && afterUndo === before, `${afterUndo}`);

    // 5. Tabs.
    for (const [tab, marker] of [["Ask", ".ask"], ["Sources", ".sources"], ["Plan", ".intake"]]) {
      const r = await click(byText("button.tab", tab));
      check(`"${tab}" tab opens its section`, r.found && (await activeTab()) === tab && (await ev(`!!document.querySelector(${JSON.stringify(marker)})`)));
    }

    // 6. Ask chips only fill the box. Nothing is sent until the person presses Ask.
    await click(byText("button.tab", "Ask"));
    // Counts the requests the page sends to /api/ask. Idempotent, and lost on reload, so call it again after one.
    const countRequests = () => ev(`(() => { if (!window.__sent) { window.__sent = 0; const real = window.fetch.bind(window); window.fetch = (u, i) => { if (String(u).includes("/api/ask")) window.__sent++; return real(u, i); }; } return window.__sent; })()`);
    const sent = () => ev(`window.__sent`);
    const boxValue = () => ev(`document.querySelector("#q").value`);
    await countRequests();
    const chipText = await ev(`document.querySelector(".chip")?.textContent ?? ""`);
    const chip = await click(`document.querySelector(".chip")`);
    await sleep(800);
    check("an example chip fills the box and sends nothing", chip.found && (await boxValue()) === chipText && (await sent()) === 0, `box="${await boxValue()}" sent=${await sent()}`);
    check("an example chip shows no result and no loading state", !(await ev(`!!document.querySelector(".ask-result .answer, .ask-result .callout")`)));
    check("the box has focus, ready to edit or send", await ev(`document.activeElement?.id === "q"`));
    check("the Ask button is enabled for the filled question", await ev(`!document.querySelector(".ask-form .btn").disabled`));
    await click(`document.querySelector(".ask-form .btn")`);
    await sleep(1200);
    check("pressing Ask afterwards sends it, once, and shows the result", (await sent()) === 1 && (await ev(`!!document.querySelector(".ask-result .answer, .ask-result .callout")`)), `sent=${await sent()}`);
    await ev(`(() => { const i = document.querySelector("#q"); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(i, i.value + " in Berlin"); i.dispatchEvent(new Event("input", { bubbles: true })); })()`);
    check("a filled question can be edited, and editing hides the old answer", (await boxValue()).endsWith(" in Berlin") && !(await ev(`!!document.querySelector(".ask-result .answer")`)) && (await sent()) === 1);
    const chip2 = await click(`document.querySelectorAll(".chip")[1]`);
    await sleep(500);
    check("picking another chip replaces the text and still sends nothing", chip2.found && !(await boxValue()).endsWith(" in Berlin") && (await sent()) === 1, `sent=${await sent()}`);

    // 7. The situation form changes the plan.
    await click(byText("button.tab", "Plan"));
    await ev(`(() => { const i = document.querySelector("#in-moveInDate"); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      set.call(i, "2026-11-01"); i.dispatchEvent(new Event("input", { bubbles: true })); })()`);
    await sleep(500);
    check("changing a date updates the plan", (await ev(`document.body.innerText`)).includes("15 Nov 2026"));

    // 8. Examples never overwrite or get saved as the person's own data.
    const KEY = "ankunft.final.v1";
    const reload = async () => {
      await S("Page.navigate", { url });
      await sleep(3500);
    };
    const setInput = (id, value) =>
      ev(`(() => { const i = document.querySelector("#${id}"); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(i, ${JSON.stringify(value)}); i.dispatchEvent(new Event("input", { bubbles: true })); })()`);
    const saved = async () => JSON.parse((await ev(`localStorage.getItem(${JSON.stringify(KEY)}) ?? "null"`)) ?? "null");
    const val = (id) => ev(`document.querySelector("#${id}")?.value ?? null`);
    const has = (sel) => ev(`!!document.querySelector(${JSON.stringify(sel)})`);
    const resultTextNow = () => ev(`document.querySelector(".ask-result")?.innerText ?? ""`);

    await ev(`localStorage.clear()`);
    await reload();
    await setInput("in-moveInDate", "2026-11-01");
    await sleep(500);
    check("a date typed by the person is saved", (await saved())?.values?.moveInDate === "2026-11-01");

    await click(byText("button.scen", "Moved in 3 days ago"));
    check("a preset asks before replacing existing entries", (await has('[aria-label="Confirm example"]')) && !(await has(".demo-banner")), "no confirmation shown");
    check("the person's date is untouched while the question is open", (await val("in-moveInDate")) === "2026-11-01");

    await click(byText("button", "Cancel"));
    check("Cancel keeps everything as it was", !(await has('[aria-label="Confirm example"]')) && !(await has(".demo-banner")) && (await val("in-moveInDate")) === "2026-11-01");

    await click(byText("button.scen", "Moved in 3 days ago"));
    await click(byText("button", "Show the example"));
    check("confirming shows the example", (await has(".demo-banner")) && (await val("in-moveInDate")) === "2026-11-11");
    const during = await saved();
    check("the example is not saved: stored data is still the person's own", during?.values?.moveInDate === "2026-11-01" && !("demoDate" in (during ?? {})), JSON.stringify(during));

    await reload();
    check("after a reload the example is gone and the person's own date is back", !(await has(".demo-banner")) && (await val("in-moveInDate")) === "2026-11-01");

    await click(byText("button.scen", "Moved in 20 days ago"));
    await click(byText("button", "Show the example"));
    await click(byText("button", "Back to my own plan"));
    check('"Back to my own plan" restores the person\'s entries', !(await has(".demo-banner")) && (await val("in-moveInDate")) === "2026-11-01");

    // 9. Invalid and extreme dates never crash the page.
    check("date inputs carry min and max", (await ev(`[...document.querySelectorAll('input[type="date"]')].every((i) => i.min === "2000-01-01" && i.max === "2100-12-31")`)));
    for (const bad of ["9999-12-31", "1999-01-01", "0001-01-01"]) {
      await setInput("in-moveInDate", bad);
      await sleep(400);
      const okPage = (await has(".plate")) && (await has("#in-moveInDate-error")) && !(await ev(`document.body.innerText.includes("This page couldn")`));
      check(`a move-in date of ${bad} shows a message and the page keeps working`, okPage);
    }
    const t = await click(byText("button.tab", "Ask"));
    check("the page is still interactive after a bad date", t.found && (await activeTab()) === "Ask");
    await click(byText("button.tab", "Plan"));
    await setInput("in-moveInDate", "2026-11-01");
    await sleep(400);
    check("a good date clears the message", !(await has("#in-moveInDate-error")));

    // 10. Damaged saved data falls back safely, and valid parts are kept.
    for (const [label, raw] of [
      ["malformed JSON", "{bad"],
      ["wrong types", JSON.stringify({ values: "x", done: 5 })],
      ["an array", "[1,2]"],
    ]) {
      await ev(`localStorage.setItem(${JSON.stringify(KEY)}, ${JSON.stringify(raw)})`);
      await reload();
      check(`saved data that is ${label} starts fresh without crashing`, (await has("button.scen")) && (await has(".plate")) && !(await ev(`document.body.innerText.includes("This page couldn")`)) && (await val("in-entryType")) === "national_visa");
    }
    await ev(`localStorage.setItem(${JSON.stringify(KEY)}, ${JSON.stringify(JSON.stringify({ values: { entryType: "national_visa", moveInDate: "2026-11-01", visaEndDate: "9999-12-31" }, done: ["landlord_confirmation", "bogus"] }))})`);
    await reload();
    check("valid saved progress is kept when other saved parts are invalid", (await val("in-moveInDate")) === "2026-11-01" && (await val("in-visaEndDate")) === "" && (await has(".notice-banner")) && !(await has(".demo-banner")) && (await ev(`document.body.innerText.includes("left out")`)));

    // 11. Planner scenarios: entry route copy, alternatives, future and passed dates, stale marks, completion.
    const PAST = "2024-01-05"; // always before today, so these checks do not depend on the real date
    const setSelect = (id, value) =>
      ev(`(() => { const e = document.querySelector("#${id}"); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(e, ${JSON.stringify(value)}); e.dispatchEvent(new Event("change", { bubbles: true })); })()`);
    const text = () => ev(`document.body.innerText`);
    const textOf = (sel) => ev(`[...document.querySelectorAll(${JSON.stringify(sel)})].map((e) => e.textContent).join(" || ")`);
    await ev(`localStorage.clear()`);
    await reload();

    await setSelect("in-entryType", "unsure");
    await sleep(400);
    let page = await text();
    check('"I am not sure" explains German national study visas, not the visa-free message', /German national study visa/.test(page) && /Choose how you entered Germany/.test(page) && !/Visa-free entry follows/.test(page), page.slice(0, 120));
    await setSelect("in-entryType", "visa_free");
    await sleep(400);
    page = await text();
    check("visa-free entry still shows its own explanation", /Visa-free entry follows different rules/.test(page) && /Not covered yet/.test(page));
    await setSelect("in-entryType", "national_visa");
    await sleep(400);

    await setInput("in-moveInDate", PAST);
    await sleep(400);
    const alt = await ev(`[...document.querySelectorAll(".missing")].map((e) => e.textContent).filter((x) => /either/.test(x))`);
    check("an either-or requirement says either is enough", alt.some((x) => /either .+ or .+\(one is enough\)/.test(x)), JSON.stringify(alt).slice(0, 160));
    check("the task board shows alternatives as alternatives", /either .*\(one is enough\)/.test(await textOf(".row-wait")));

    await setInput("in-moveInDate", "2099-01-01");
    await sleep(400);
    const futureMissing = await textOf(".missing");
    check("a future move-in date is described as still in the future, not as missing", /Move-in date: 1 Jan 2099 is still in the future/.test(futureMissing) && !/Move-in date(?!:)/.test(futureMissing));
    check("a note beside the move-in field says it is in the future", /still in the future/.test(await textOf(".field-info")));

    await setInput("in-moveInDate", "");
    await setInput("in-visaEndDate", "2001-01-01");
    await sleep(400);
    check("a visa end date that has passed gets a calm note, with no day count", /already passed/.test(await textOf(".field-warn")) && !/\d+ days/.test(await textOf(".field-warn")));
    const leaRow = await ev(`[...document.querySelectorAll(".row")].find((r) => /residence-permit application/i.test(r.querySelector(".row-title")?.textContent ?? ""))?.textContent ?? ""`);
    check("no misleading negative-day guidance for it: the passed guidance date just says it has passed", /this date has passed/.test(leaRow) && !/overdue/i.test(leaRow) && !/-\d+ days|\d+ days (ago|overdue)/.test(leaRow), leaRow.slice(0, 160));

    await setInput("in-visaEndDate", "");
    await setInput("in-arrivalDate", "2026-11-10");
    await setInput("in-moveInDate", "2026-10-01");
    await sleep(400);
    check("a move-in date before the arrival date is flagged", /before your arrival date/.test(await textOf(".field-warn")));
    await setInput("in-arrivalDate", "");
    await setInput("in-moveInDate", PAST);
    await sleep(400);

    // A step marked done stops counting when what it depends on goes away, and counts again when it returns.
    const marked = await click(`document.querySelector(".plate .btn")`);
    check("marking the next step done works", marked.found);
    await setInput("in-moveInDate", "");
    await sleep(500);
    page = await ev(`document.body.textContent`);
    check("a done step whose prerequisite was removed is shown as waiting, with an explanation", /You marked this as done earlier/.test(page) && /Remove my/.test(page));
    check("it no longer counts as Done", !(await ev(`[...document.querySelectorAll(".row-done")].some((r) => /landlord/i.test(r.textContent))`)));
    await setInput("in-moveInDate", PAST);
    await sleep(500);
    check("when the prerequisite returns, the mark counts again", !/You marked this as done earlier/.test(await ev(`document.body.textContent`)) && (await ev(`[...document.querySelectorAll(".row-done")].some((r) => /landlord/i.test(r.textContent))`)));

    // Finishing everything gives a completion state, not an empty next-step card.
    await click(`document.querySelector(".check input")`);
    let guard = 0;
    while (guard++ < 20 && (await has(".plate .btn"))) await click(`document.querySelector(".plate .btn")`);
    const plateText = await ev(`document.querySelector(".plate")?.innerText ?? ""`);
    check("when every step is done the card says so", /All steps are done/.test(plateText) && (await has(".plate-complete")), plateText.slice(0, 80));
    check("the completion card has no action button and no 'nothing is ready' text", !(await has(".plate .btn")) && !/Nothing is ready/.test(plateText));

    // 12. Q&A through the real Ask page: typed, submitted, and read back as a person would see it.
    await ev(`localStorage.clear()`);
    await reload();
    await click(byText("button.tab", "Ask"));
    const askPage = async (question) => {
      await ev(`(() => { const i = document.querySelector("#q"); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(i, ${JSON.stringify(question)}); i.dispatchEvent(new Event("input", { bubbles: true })); })()`);
      await sleep(150);
      await click(`document.querySelector(".ask-form .btn")`);
      await sleep(1200);
      return {
        text: await ev(`document.querySelector(".ask-result")?.innerText ?? ""`),
        sources: await ev(`document.querySelectorAll(".ask-result .answer").length`),
        kind: await ev(`document.querySelector(".ask-result .guidance") ? "guidance" : document.querySelector(".ask-result .callout-abstain") ? "abstain" : document.querySelector(".ask-result .callout-refuse") ? "refuse" : document.querySelector(".ask-result .answer") ? "answer" : "none"`),
      };
    };
    let a = await askPage("Where can I find a flat in Berlin?");
    check("a flat-hunting question abstains and shows no citations", a.kind === "abstain" && a.sources === 0 && /not covered/.test(a.text), a.text.slice(0, 90));
    a = await askPage("What is the minimum amount in the blocked account for 2026?");
    check("the blocked-account amount question is answered with the figure", a.kind === "answer" && /11,904 EUR/.test(a.text), a.text.slice(0, 90));
    a = await askPage("Which documents are needed for Anmeldung?");
    check("an Anmeldung document list shows the Anmeldung documents first", a.kind === "answer" && /proof of identity/i.test(a.text.split("\n").slice(0, 4).join(" ")), a.text.slice(0, 120));
    a = await askPage("Where is the immigration office?");
    check("the LEA address is answered, with its source", a.kind === "answer" && /Keplerstraße 2, 10589 Berlin/.test(a.text) && a.sources === 1, a.text.slice(0, 120));
    a = await askPage("Where is the Bürgeramt?");
    check("a Bürgeramt address is not invented", a.kind === "abstain" && !/Keplerstraße/.test(a.text) && a.sources === 0, a.text.slice(0, 90));
    a = await askPage("What are the opening hours of the immigration office?");
    check("opening hours are not invented", a.kind === "abstain" && a.sources === 0);
    a = await askPage("Was kostet die Anmeldung?");
    check("a German fee question is answered from the fee passage", a.kind === "answer" && /no fee/i.test(a.text), a.text.slice(0, 90));
    a = await askPage("how do i regester my adress in berlin");
    check("a question with typos is understood", a.kind === "answer" && a.sources > 0, a.kind);
    // batch 4
    a = await askPage("How do I get a library card in Berlin?");
    check("a library-card question abstains with no citation (it is not answered with the enrolment note)", a.kind === "abstain" && a.sources === 0 && !/enrol/i.test(a.text), a.text.slice(0, 100));
    a = await askPage("Can I use the university library before I have enrolled?");
    check("the enrolment note itself is still answered when asked about", a.kind === "answer" && /library/i.test(a.text) && a.sources === 1, a.text.slice(0, 100));
    a = await askPage("List of documents for registering a flat.");
    check("a document list for registering a flat starts with the Anmeldung documents", a.kind === "answer" && /proof of identity/i.test(a.text.split("\n").slice(0, 4).join(" ")), a.text.slice(0, 120));
    a = await askPage("What do I need to bring to the Bürgeramt?");
    check("'what do I bring to the Bürgeramt' starts with the Anmeldung documents", a.kind === "answer" && /proof of identity/i.test(a.text.split("\n").slice(0, 4).join(" ")), a.text.slice(0, 120));
    a = await askPage("How big a deposit does the blocked account need?");
    check("the blocked-account deposit question is answered with the figure", a.kind === "answer" && /11,904 EUR/.test(a.text), a.text.slice(0, 90));
    a = await askPage("skip German cover");
    check("'skip German cover' is answered from the insurance passages", a.kind === "answer" && /exemption|exempt/i.test(a.text) && a.sources > 0, a.text.slice(0, 120));
    a = await askPage("How much is the rental deposit for a flat in Berlin?");
    check("a rental-deposit question still abstains", a.kind === "abstain" && a.sources === 0, a.text.slice(0, 90));
    a = await askPage("Wie ist das Wetter in Berlin?");
    check("an off-topic German question abstains", a.kind === "abstain" && a.sources === 0);
    a = await askPage("Will the immigration office approve my application?");
    check("a judgement question is refused with places to ask", a.kind === "refuse" && /immigration office|Service Berlin/i.test(a.text));

    // ---- Free-form questions (nothing entered yet) ----
    a = await askPage("Just landed, what should I do?");
    check("free-form: 'just landed, what should I do?' with nothing entered gets the cited general steps and says so", a.kind === "answer" && a.sources === 1 && /do not know your situation yet/.test(a.text) && /Make it in Germany/i.test(a.text), a.text.slice(0, 120));
    a = await askPage("I haven't registered my address yet. What do I need?");
    check("free-form: 'I haven't registered yet. What do I need?' is answered with the Anmeldung documents", a.kind === "answer" && /proof of identity/i.test(a.text), a.text.slice(0, 120));
    a = await askPage("Where is the university library?");
    check("free-form: 'where is the university library?' abstains with no citation", a.kind === "abstain" && a.sources === 0 && !/enrol/i.test(a.text), a.text.slice(0, 100));
    a = await askPage("Can I do anything while waiting for my residence permit appointment?");
    check("free-form: 'anything while waiting for my appointment' is guidance from the pack's own notes, with a source link", a.kind === "guidance" && /Bring everything listed/.test(a.text) && (await ev(`document.querySelectorAll(".ask-result .guidance a").length`)) > 0 && a.sources === 0, a.text.slice(0, 120));
    a = await askPage("visa");
    const chips = await ev(`document.querySelectorAll(".ask-result .clarify .chip").length`);
    check("a one-word question asks what was meant and offers questions", a.kind === "abstain" && /I need a little more/.test(a.text) && chips >= 2, `${chips} options`);
    await countRequests();
    const sentBefore = await sent();
    const optionText = await ev(`document.querySelector(".ask-result .clarify .chip").textContent`);
    await click(`document.querySelector(".ask-result .clarify .chip")`);
    await sleep(700);
    check("choosing an offered question only fills the box: nothing is sent and the old reply is gone", (await boxValue()) === optionText && (await sent()) === sentBefore && !(await has(".ask-result .clarify")) && (await resultTextNow()).trim() === "", `box="${await boxValue()}"`);
    await click(`document.querySelector(".ask-form .btn")`);
    await sleep(1000);
    check("pressing Ask then gives a cited answer", (await sent()) === sentBefore + 1 && (await ev(`document.querySelectorAll(".ask-result .answer").length`)) > 0);

    // ---- Free-form questions with the person's own entries ----
    await ev(`localStorage.setItem("ankunft.final.v1", JSON.stringify({ values: { entryType: "national_visa", arrivalDate: "2026-11-10", moveInDate: "2026-11-12" }, done: [] }))`);
    await reload();
    await click(byText("button.tab", "Ask"));
    for (const q of ["Just landed, what should I do?", "I arrived in Berlin today. What's next?", "What should I do first?"]) {
      a = await askPage(q);
      check(`own entries: '${q}' is answered from the plan`, a.kind === "guidance" && /from your plan/i.test(a.text) && (await ev(`document.querySelectorAll(".ask-result .answer:not(.guidance-item)").length`)) === 0 && (await ev(`document.querySelectorAll(".ask-result .guidance a").length`)) > 0, a.text.slice(0, 100));
    }
    const next = await ev(`document.querySelector(".ask-result .guidance-primary strong")?.textContent ?? ""`);
    await click(byText("button.tab", "Plan"));
    check("the step Ask names first is the step the Plan tab shows as next", next && (await plateTitle()) === next, `${next} vs ${await plateTitle()}`);
    await click(byText("button.tab", "Ask"));
    a = await askPage("Can I do anything while waiting for my residence permit appointment?");
    check("own entries: 'anything while waiting' adds the plan's other steps to the pack's notes", a.kind === "guidance" && /Bring everything listed/.test(a.text) && /Other steps you can start now/.test(a.text), a.text.slice(0, 100));
    a = await askPage("I just arrived, can I work part time?");
    check("own entries: arrival wording does not turn an unsupported question into guidance", a.kind === "abstain" && a.sources === 0);
    // An example on screen is not the person's own plan, and Ask says so.
    await click(byText("button.tab", "Plan"));
    await click(`document.querySelector("button.scen")`);
    await click(byText("button", "Show the example")); // the person has entries, so showing an example asks first
    await click(byText("button.tab", "Ask"));
    a = await askPage("What should I do first?");
    check("an example on screen is labelled as such, not as the person's own plan", a.kind === "guidance" && /example on screen/i.test(a.text), a.text.slice(0, 100));

    // ---- Stale answers, loading, request races, repeated submits, friendly errors ----
    await ev(`localStorage.clear()`);
    await reload();
    await click(byText("button.tab", "Ask"));
    const typeQ = (text) => ev(`(() => { const i = document.querySelector("#q"); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(i, ${JSON.stringify(text)}); i.dispatchEvent(new Event("input", { bubbles: true })); })()`);
    const submitForm = () => ev(`document.querySelector(".ask-form").requestSubmit()`);
    const shownQuestion = () => ev(`document.querySelector(".ask-result .asked")?.textContent ?? ""`);
    const resultText = () => ev(`document.querySelector(".ask-result")?.innerText ?? ""`);
    // A fetch that can be slowed per question, can ignore being aborted (the worst case: a late reply), and can fail.
    await ev(`(() => {
      const real = window.fetch.bind(window);
      window.__calls = []; window.__delays = {}; window.__fail = null; window.__ignoreAbort = true;
      window.fetch = (url, init) => {
        const q = JSON.parse(init.body).question;
        window.__calls.push(q);
        if (window.__fail === "network") return Promise.reject(new TypeError("Failed to fetch"));
        if (window.__fail === "html") return Promise.resolve(new Response("<html>Bad gateway</html>", { status: 502 }));
        if (window.__fail === "shape") return Promise.resolve(new Response(JSON.stringify({ foo: 1 }), { status: 200, headers: { "content-type": "application/json" } }));
        const delay = window.__delays[q] ?? 0;
        return new Promise((res, rej) => setTimeout(() => real(url, window.__ignoreAbort ? { ...init, signal: undefined } : init).then(res, rej), delay));
      };
    })()`);

    const FIRST = "How many days do I have to register my address?";
    const SECOND = "What does the landlord's confirmation have to contain?";
    await typeQ(FIRST); await submitForm(); await sleep(900);
    check("stale: an answer is shown for the first question", /register/i.test(await shownQuestion()) && (await ev(`document.querySelectorAll(".ask-result .answer").length`)) > 0);
    await typeQ(FIRST + " and");
    check("stale: typing a new question hides the previous answer at once", (await ev(`document.querySelectorAll(".ask-result .answer").length`)) === 0 && (await shownQuestion()) === "");
    await typeQ(FIRST + " "); // back to the same question (a trailing space is not a change)
    await typeQ("");
    check("stale: clearing the box leaves no old answer or error behind", (await resultText()).trim() === "");

    await ev(`window.__delays[${JSON.stringify(SECOND)}] = 1500; window.__calls.length = 0`);
    await typeQ(SECOND); await submitForm(); await sleep(250);
    const loadingText = await resultText();
    const btn = await ev(`(() => { const b = document.querySelector(".ask-form .btn"); return { text: b.textContent, disabled: b.disabled }; })()`);
    check("loading: a clear status appears and the button says it is working", /Searching the saved sources/.test(loadingText) && btn.text === "Searching" && btn.disabled, `${btn.text} / ${loadingText.slice(0, 60)}`);
    check("loading: no answer is shown while it loads", (await ev(`document.querySelectorAll(".ask-result .answer").length`)) === 0);
    await submitForm(); await submitForm();
    await sleep(100);
    check("repeats: submitting the same question again while it loads sends nothing", (await ev(`window.__calls.length`)) === 1, `${await ev(`window.__calls.length`)} requests`);
    await sleep(1700);
    check("loading: the answer replaces the status when it arrives", (await shownQuestion()).includes("landlord") && !/Searching the saved sources/.test(await resultText()));

    // Race: slow question first, fast question second. The slow reply arrives last and must be dropped.
    await ev(`window.__delays = { ${JSON.stringify(FIRST)}: 1800 }; window.__calls.length = 0`);
    await typeQ(FIRST); await submitForm(); await sleep(150);
    await typeQ(SECOND); await submitForm(); // typing replaces the question in flight; the slow reply is still delivered later
    await sleep(500);
    check("race: the newer question's answer is shown first", (await shownQuestion()).includes("landlord"), await shownQuestion());
    await sleep(2000);
    check("race: the older, slower reply arriving last does not overwrite it", (await shownQuestion()).includes("landlord") && !/How many days/.test(await shownQuestion()), await shownQuestion());
    check("race: both requests really were sent (the test is meaningful)", (await ev(`window.__calls.length`)) === 2);

    // Picking a suggestion while a request is in flight abandons it, and sends nothing itself.
    await ev(`window.__delays = { ${JSON.stringify(FIRST)}: 1500 }; window.__calls.length = 0`);
    await typeQ(FIRST); await submitForm(); await sleep(200);
    const picked = await ev(`document.querySelectorAll(".chips .chip")[1].textContent`);
    await click(`document.querySelectorAll(".chips .chip")[1]`);
    await sleep(100);
    check("chip while loading: the loading status goes away, the box holds the suggestion, nothing new is sent", !/Searching the saved sources/.test(await resultText()) && (await ev(`window.__calls.length`)) === 1 && (await ev(`document.querySelector("#q").value`)) === picked && picked !== FIRST, picked);
    await sleep(1800);
    check("chip while loading: the abandoned request's answer never appears", (await ev(`document.querySelectorAll(".ask-result .answer").length`)) === 0 && (await resultText()).trim() === "");

    // Editing while a request is in flight abandons it.
    await ev(`window.__delays = { ${JSON.stringify(FIRST)}: 1500 }`);
    await typeQ(FIRST); await submitForm(); await sleep(200);
    await typeQ("Something else I am typing");
    check("edit while loading: the loading status goes away", !/Searching the saved sources/.test(await resultText()));
    await sleep(1800);
    check("edit while loading: the abandoned request's answer never appears", (await ev(`document.querySelectorAll(".ask-result .answer").length`)) === 0 && (await resultText()).trim() === "", (await resultText()).slice(0, 80));

    // Friendly errors.
    await ev(`window.__delays = {}; window.__fail = "network"`);
    await typeQ(FIRST); await submitForm(); await sleep(500);
    let errText = await resultText();
    check("errors: a lost connection says so in plain words, not 'Failed to fetch'", /Could not reach Ask/.test(errText) && !/Failed to fetch/i.test(errText), errText.slice(0, 100));
    await ev(`window.__fail = "html"`);
    await click(byText(".ask-result button", "Try again"));
    await sleep(500);
    errText = await resultText();
    check("errors: a server error page is not shown raw", /problem on our side/.test(errText) && !/html|Bad gateway|Unexpected token/i.test(errText), errText.slice(0, 100));
    await ev(`window.__fail = "shape"`);
    await click(byText(".ask-result button", "Try again"));
    await sleep(500);
    check("errors: a reply that is not an answer is handled, not crashed on", /problem on our side/.test(await resultText()));
    await ev(`window.__fail = null`);
    await click(byText(".ask-result button", "Try again"));
    await sleep(800);
    check("errors: 'Try again' recovers once the problem is gone", (await ev(`document.querySelectorAll(".ask-result .answer").length`)) > 0 && !(await has(".ask-result .callout-warn")));

    const errors = events.filter((e) => e.method === "Runtime.exceptionThrown").length;
    check("no uncaught exceptions", errors === 0, `${errors}`);
    return results;
  });
}

let failed = 0;
for (const url of urls) {
  console.log(`\n${url}`);
  let results;
  try {
    results = await runOrigin(url);
  } catch (e) {
    results = [{ name: "run the browser checks", ok: false, detail: String(e.message ?? e) }];
  }
  for (const r of results) {
    console.log(`  ${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.ok || !r.detail ? "" : `  (${r.detail})`}`);
    if (!r.ok) failed++;
  }
}
console.log(failed ? `\n${failed} check(s) failed` : "\nAll interaction checks passed");
process.exit(failed ? 1 : 0);
