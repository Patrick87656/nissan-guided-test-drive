/**
 * dealer-extras.test.js - "Read highlight notes aloud" (js/voice-prefs.js)
 * and the printable route card (js/print-card.js).
 */
(function () {
  const V = KPR.voicePrefs;
  const P = KPR.printCard;
  const $ = (id) => document.getElementById(id);

  function fakeStore(initial) {
    const data = Object.assign({}, initial);
    return {
      data,
      getItem: (k) => (k in data ? data[k] : null),
      setItem: (k, v) => { data[k] = String(v); },
      removeItem: (k) => { delete data[k]; },
    };
  }

  // ---- voice prefs ------------------------------------------------------

  test("voice: notes are read aloud by default (nothing stored)", () => {
    V.useStorage(fakeStore());
    try {
      assert.equal(V.getSpeakNotes(), true);
    } finally {
      V.useStorage(null);
    }
  });

  test("voice: the choice is stored as 1 / 0 and read back; junk counts as the default", () => {
    const s = fakeStore();
    V.useStorage(s);
    try {
      V.setSpeakNotes(false);
      assert.equal(s.data[V.STORAGE_KEY], "0");
      assert.equal(V.getSpeakNotes(), false);
      V.setSpeakNotes(true);
      assert.equal(s.data[V.STORAGE_KEY], "1");
      assert.equal(V.getSpeakNotes(), true);
      s.data[V.STORAGE_KEY] = "garbage";
      assert.equal(V.getSpeakNotes(), true);
    } finally {
      V.useStorage(null);
    }
  });

  test("voice: storage that throws never breaks the setting", () => {
    V.useStorage({ getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } });
    try {
      assert.equal(V.getSpeakNotes(), true);
      V.setSpeakNotes(false); // must not throw
    } finally {
      V.useStorage(null);
    }
  });

  test("voice: the start announcement includes notes only when the setting is on", () => {
    assert.equal(V.startAnnouncement("Driver Assist", "Highway merge", "Show lane centering.", true),
      "Driver Assist: Highway merge. Show lane centering.");
    assert.equal(V.startAnnouncement("Driver Assist", "Highway merge", "Show lane centering.", false),
      "Driver Assist: Highway merge.");
    assert.equal(V.startAnnouncement("Acceleration", "On-ramp", "", true), "Acceleration: On-ramp.");
  });

  test("voice: the checkbox loads the stored value and saves changes", () => {
    const s = fakeStore({ [V.STORAGE_KEY]: "0" });
    V.useStorage(s);
    try {
      const box = $("speak-notes");
      const fresh = box.cloneNode(true); // drop any earlier listener
      box.replaceWith(fresh);
      V.init();
      assert.equal(fresh.checked, false);
      fresh.checked = true;
      fresh.dispatchEvent(new Event("change"));
      assert.equal(s.data[V.STORAGE_KEY], "1");
    } finally {
      V.useStorage(null);
    }
  });

  // ---- print card: model ------------------------------------------------

  const input = () => ({
    name: "  Showroom loop  ",
    summary: { distanceMeters: 19125.666, durationSeconds: 1563 },
    waypoints: [
      { lat: 42.5, lng: -83.4, name: "Nissan of Example", detail: "123 Main St" },
      { lat: 42.51, lng: -83.41, name: "", detail: "" },
      { lat: 42.52, lng: -83.42, name: "I-696 ramp", detail: "" },
    ],
    scenes: [
      { type: "Driver Assist", typeLabel: "Driver Assist", label: "Highway", notes: "ProPILOT", color: "#8b5cf6", startIdx: 40 },
      { type: "Acceleration", typeLabel: "Acceleration", label: "On-ramp", notes: "", color: "#f59e0b", startIdx: 10 },
    ],
    link: "https://h.test/app/#r=dABC",
  });

  test("print: model has rounded miles/minutes, numbered stops and highlights in driving order", () => {
    const m = P.buildModel(input());
    assert.equal(m.name, "Showroom loop");
    assert.equal(m.miles, "11.9");
    assert.equal(m.minutes, "26");
    assert.equal(m.stopCount, 3);
    assert.deepEqual(m.stops.map((s) => s.number), [1, 2, 3]);
    assert.equal(m.stops[0].name, "Nissan of Example");
    assert.equal(m.stops[1].name, "42.51000, -83.41000", "unnamed stop falls back to coordinates");
    assert.deepEqual(m.highlights.map((h) => h.label), ["On-ramp", "Highway"]);
    assert.equal(m.highlights[0].color, "#f59e0b");
  });

  test("print: missing summary / name / scenes give safe placeholders", () => {
    const m = P.buildModel({ waypoints: [], scenes: null });
    assert.equal(m.name, "Untitled route");
    assert.equal(m.miles, "–");
    assert.equal(m.minutes, "–");
    assert.deepEqual(m.highlights, []);
    assert.equal(P.buildModel(null).stopCount, 0);
  });

  test("print: a non-hex highlight color is replaced by Nissan red", () => {
    const i = input();
    i.scenes[0].color = "red; background:url(x)";
    const m = P.buildModel(i);
    assert.equal(m.highlights.find((h) => h.label === "Highway").color, "#c3002f");
  });

  // ---- print card: render -----------------------------------------------

  test("print: render fills the card with name, stats, stops, highlights and a QR code", () => {
    const card = P.render(P.buildModel(input()), null);
    assert.equal(card.querySelector(".pc-name").textContent, "Showroom loop");
    assert.equal(card.querySelectorAll(".pc-stops li").length, 3);
    assert.equal(card.querySelectorAll(".pc-highlights li").length, 2);
    assert.equal(card.querySelector(".pc-hl-label").textContent, "On-ramp");
    const qr = card.querySelector(".pc-qr");
    assert.ok(qr && qr.src.startsWith("data:image/png"), "QR image");
    assert.equal(card.querySelector(".pc-map"), null, "no map picture when none was captured");
    assert.ok(card.querySelector(".pc-logo").src.endsWith("icons/nissan-wordmark-black.png"));
    assert.ok(card.querySelector(".pc-safety").textContent.includes("traffic laws"));
  });

  test("print: a map picture is shown when one was captured", () => {
    const card = P.render(P.buildModel(input()), "data:image/jpeg;base64,AAAA");
    assert.equal(card.querySelector(".pc-map").getAttribute("src"), "data:image/jpeg;base64,AAAA");
  });

  test("print: no link (too long to share) prints without a QR and says why", () => {
    const i = input();
    i.link = "";
    const card = P.render(P.buildModel(i), null);
    assert.equal(card.querySelector(".pc-qr"), null);
    assert.ok(card.querySelector(".pc-foot").textContent.includes("too long for a QR"));
  });

  test("print: hostile text from a route stays literal text (no markup is created)", () => {
    const evil = '<img src=x onerror="window.__pc=1"><script>window.__pc=2</script>';
    const i = input();
    i.name = evil;
    i.waypoints[0].name = evil;
    i.waypoints[0].detail = evil;
    i.scenes[0].label = evil;
    i.scenes[0].notes = evil;
    i.scenes[0].typeLabel = evil;
    const card = P.render(P.buildModel(i), null);
    assert.equal(card.querySelector(".pc-name").textContent, evil);
    assert.equal(card.querySelectorAll("script").length, 0);
    // Only the card's own images: logo + QR.
    assert.deepEqual(Array.from(card.querySelectorAll("img")).map((im) => im.className).sort(), ["pc-logo", "pc-qr"]);
    assert.equal(window.__pc, undefined);
  });

  test("print: rendering again replaces the previous card", () => {
    P.render(P.buildModel(input()), null);
    const i = input();
    i.name = "Second";
    const card = P.render(P.buildModel(i), null);
    assert.equal(card.querySelectorAll(".pc-name").length, 1);
    assert.equal(card.querySelector(".pc-name").textContent, "Second");
    card.replaceChildren();
  });
})();
