/**
 * print-card.js — "Print card": a one-page route sheet for the sales desk.
 *
 * The card has the Nissan wordmark, the route name, miles / minutes / stops,
 * a picture of the route, the numbered stops, every highlight with its
 * notes, and the route's QR code ("scan to open this route"). It is started
 * from the Share dialog, which already holds the route link.
 *
 * How it prints: the card is filled into the hidden #print-card element and
 * window.print() is called; the print stylesheet (style.css, @media print)
 * hides everything else on the page, so only the card goes to paper / PDF.
 *
 * Map picture: the Mapbox canvas is read once right after a frame renders
 * (so no preserveDrawingBuffer is needed). For the capture the map briefly
 * switches to the Day style (Night would waste ink) and fits the whole route;
 * the user's style and camera are put back afterwards. Stop pins are DOM
 * markers, not part of the canvas, so numbered dots are drawn onto the
 * picture instead.
 *
 * Every piece of text comes from a route file or a share link, so it only
 * ever reaches the page through textContent (no innerHTML here).
 */
window.KPR = window.KPR || {};

KPR.printCard = (function () {
  const $ = (id) => document.getElementById(id);
  const RED = "#c3002f";

  // ---------------------------------------------------------------------
  // Pure: the card's content
  // ---------------------------------------------------------------------

  const _text = (v) => (typeof v === "string" ? v : v == null ? "" : String(v));

  /**
   * {name, summary:{distanceMeters,durationSeconds}|null,
   *  waypoints:[{name,detail,lat,lng}], scenes:[{type,typeLabel,label,notes,
   *  color,startIdx}], link} -> the model render() draws. Highlights are put in
   * driving order (by where they start on the route).
   */
  function buildModel(input) {
    const src = input || {};
    const summary = src.summary || null;
    const meters = summary && Number.isFinite(summary.distanceMeters) ? summary.distanceMeters : null;
    const secs = summary && Number.isFinite(summary.durationSeconds) ? summary.durationSeconds : null;
    const wps = Array.isArray(src.waypoints) ? src.waypoints : [];
    const scenes = Array.isArray(src.scenes) ? src.scenes.slice() : [];
    scenes.sort((a, b) => (Number(a && a.startIdx) || 0) - (Number(b && b.startIdx) || 0));

    return {
      name: _text(src.name).trim() || "Untitled route",
      miles: meters === null ? "–" : (meters / 1609.34).toFixed(1),
      minutes: secs === null ? "–" : String(Math.round(secs / 60)),
      stopCount: wps.length,
      stops: wps.map((w, i) => ({
        number: i + 1,
        name: _text(w && w.name) || (w && Number.isFinite(w.lat) ? `${w.lat.toFixed(5)}, ${w.lng.toFixed(5)}` : `Stop ${i + 1}`),
        detail: _text(w && w.detail),
      })),
      highlights: scenes.filter(Boolean).map((s) => ({
        type: _text(s.typeLabel || s.type) || "Highlight",
        label: _text(s.label),
        notes: _text(s.notes),
        color: KPR.scenes && KPR.scenes.safeColor ? KPR.scenes.safeColor(s.color, RED) : RED,
      })),
      link: _text(src.link),
    };
  }

  // ---------------------------------------------------------------------
  // DOM: fill #print-card
  // ---------------------------------------------------------------------

  function _el(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text != null) el.textContent = text;
    return el;
  }

  /** The QR code as a PNG data URL, or null when the link is empty or too long. */
  function _qrDataUrl(link) {
    if (!link || !KPR.share || !KPR.share.buildQr) return null;
    const qr = KPR.share.buildQr(link);
    if (!qr) return null;
    const canvas = document.createElement("canvas");
    KPR.share.drawQr(canvas, qr);
    return canvas.toDataURL("image/png");
  }

  /** Replace #print-card's contents with `model`. `mapUrl` (data URL) is optional. */
  function render(model, mapUrl) {
    const card = $("print-card");
    card.replaceChildren();

    const head = _el("header", "pc-head");
    const logo = _el("img", "pc-logo");
    logo.src = "icons/nissan-wordmark-black.png";
    logo.alt = "Nissan";
    head.appendChild(logo);
    head.appendChild(_el("span", "pc-app", "Guided Test Drive"));
    card.appendChild(head);

    card.appendChild(_el("h1", "pc-name", model.name));

    const stats = _el("ul", "pc-stats");
    [[model.miles, "miles"], [model.minutes, "minutes"], [String(model.stopCount), "stops"]].forEach(([v, l]) => {
      const li = _el("li");
      li.appendChild(_el("strong", null, v));
      li.appendChild(_el("span", null, " " + l));
      stats.appendChild(li);
    });
    card.appendChild(stats);

    if (mapUrl) {
      const img = _el("img", "pc-map");
      img.src = mapUrl;
      img.alt = "Map of the route";
      card.appendChild(img);
    }

    const cols = _el("div", "pc-cols");

    const stopsCol = _el("section", "pc-col");
    stopsCol.appendChild(_el("h2", null, "Stops"));
    const ol = _el("ol", "pc-stops");
    model.stops.forEach((s) => {
      const li = _el("li");
      li.appendChild(_el("span", "pc-num", String(s.number)));
      const t = _el("div");
      t.appendChild(_el("div", "pc-stop-name", s.name));
      if (s.detail) t.appendChild(_el("div", "pc-stop-detail", s.detail));
      li.appendChild(t);
      ol.appendChild(li);
    });
    stopsCol.appendChild(ol);
    cols.appendChild(stopsCol);

    const hlCol = _el("section", "pc-col");
    hlCol.appendChild(_el("h2", null, "Highlights to point out"));
    if (model.highlights.length === 0) {
      hlCol.appendChild(_el("p", "pc-empty", "No highlights on this route."));
    } else {
      const ul = _el("ol", "pc-highlights");
      model.highlights.forEach((h) => {
        const li = _el("li");
        li.style.borderLeftColor = h.color;
        const type = _el("div", "pc-hl-type", h.type);
        type.style.color = h.color;
        li.appendChild(type);
        if (h.label) li.appendChild(_el("div", "pc-hl-label", h.label));
        if (h.notes) li.appendChild(_el("div", "pc-hl-notes", h.notes));
        ul.appendChild(li);
      });
      hlCol.appendChild(ul);
    }
    cols.appendChild(hlCol);
    card.appendChild(cols);

    const foot = _el("footer", "pc-foot");
    const qrUrl = _qrDataUrl(model.link);
    if (qrUrl) {
      const qr = _el("img", "pc-qr");
      qr.src = qrUrl;
      qr.alt = "QR code for this route";
      foot.appendChild(qr);
      const t = _el("div", "pc-qr-text");
      t.appendChild(_el("strong", null, "Scan to open this route"));
      t.appendChild(_el("div", null, "Point a phone camera at the code, then tap Start drive. In the installed app, use Open a shared link."));
      foot.appendChild(t);
    } else {
      foot.appendChild(_el("p", "pc-qr-text", "This route is too long for a QR code. Share the route file instead."));
    }
    card.appendChild(foot);
    card.appendChild(_el("p", "pc-safety", "The customer drives; the salesperson operates the app. Obey all traffic laws."));
    return card;
  }

  // ---------------------------------------------------------------------
  // Map picture
  // ---------------------------------------------------------------------

  function _waitIdle(map, ms) {
    return new Promise((resolve) => {
      const t = setTimeout(resolve, ms);
      map.once("idle", () => {
        clearTimeout(t);
        resolve();
      });
      map.triggerRepaint();
    });
  }

  /** Read the canvas inside the render event (the frame is still there). */
  function _grabCanvas(map) {
    return new Promise((resolve) => {
      const t = setTimeout(() => resolve(null), 3000);
      map.once("render", () => {
        clearTimeout(t);
        try {
          const src = map.getCanvas();
          const out = document.createElement("canvas");
          out.width = src.width;
          out.height = src.height;
          out.getContext("2d").drawImage(src, 0, 0);
          resolve(out);
        } catch (err) {
          resolve(null);
        }
      });
      map.triggerRepaint();
    });
  }

  /** Numbered red dots for the stops (they are DOM markers, so not in the canvas). */
  function _drawStops(canvas, map, waypoints) {
    const ctx = canvas.getContext("2d");
    const k = canvas.width / (map.getCanvas().clientWidth || canvas.width);
    const r = 11 * k;
    ctx.font = `700 ${Math.round(11 * k)}px Inter, "Segoe UI", Arial, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    waypoints.forEach((w, i) => {
      const p = map.project([w.lng, w.lat]);
      const x = p.x * k;
      const y = p.y * k;
      ctx.beginPath();
      ctx.arc(x, y, r + 2.5 * k, 0, Math.PI * 2);
      ctx.fillStyle = "#ffffff";
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = RED;
      ctx.fill();
      ctx.fillStyle = "#ffffff";
      ctx.fillText(String(i + 1), x, y + 0.5 * k);
    });
  }

  /** Data URL of the whole route on the Day map, or null if it can't be made. */
  async function captureMap() {
    const map = KPR.map && KPR.map.getMap ? KPR.map.getMap() : null;
    const coords = KPR.routing ? KPR.routing.getRouteCoords() : null;
    if (!map || !coords || coords.length < 2) return null;

    const cam = {
      center: map.getCenter(),
      zoom: map.getZoom(),
      bearing: map.getBearing(),
      pitch: map.getPitch(),
      padding: map.getPadding(),
    };
    const prevStyle = KPR.map.getStyleKey();
    try {
      if (prevStyle !== "day") KPR.map.setStyleKey("day");
      map.setPadding({ top: 0, bottom: 0, left: 0, right: 0 });
      const first = [coords[0].lng, coords[0].lat];
      const bounds = coords.reduce((b, c) => b.extend([c.lng, c.lat]), new mapboxgl.LngLatBounds(first, first));
      map.fitBounds(bounds, { padding: 48, duration: 0, bearing: 0, pitch: 0 });
      await _waitIdle(map, 8000);
      const canvas = await _grabCanvas(map);
      if (!canvas) return null;
      _drawStops(canvas, map, KPR.waypoints.getSaveData());
      return canvas.toDataURL("image/jpeg", 0.88);
    } catch (err) {
      console.warn("Print card: map picture unavailable.", err);
      return null;
    } finally {
      if (prevStyle !== "day") KPR.map.setStyleKey(prevStyle);
      map.jumpTo(cam);
    }
  }

  // ---------------------------------------------------------------------
  // Printing
  // ---------------------------------------------------------------------

  let busy = false;

  /** The current route as a model (link comes from the Share dialog). */
  function currentModel(link) {
    return buildModel({
      name: $("route-name").value,
      summary: KPR.routing.getSummary(),
      waypoints: KPR.waypoints.getSaveData(),
      scenes: KPR.scenes.getAll(),
      link,
    });
  }

  async function print(link) {
    if (busy) return;
    if (KPR.waypoints.count() < 2) {
      alert("Add at least 2 stops to print a route card.");
      return;
    }
    busy = true;
    const btn = $("share-print");
    const label = btn ? btn.textContent : "";
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Preparing card…";
    }
    try {
      const mapUrl = await captureMap();
      const card = render(currentModel(link), mapUrl);
      // Images must be decoded before the print snapshot, or they print blank.
      await Promise.all(
        Array.from(card.querySelectorAll("img")).map((img) =>
          img.decode ? img.decode().catch(() => {}) : Promise.resolve()
        )
      );
      window.print();
    } finally {
      busy = false;
      if (btn) {
        btn.disabled = false;
        btn.textContent = label;
      }
    }
  }

  function init() {
    const btn = $("share-print");
    if (!btn) return;
    btn.addEventListener("click", () => print($("share-link").value));
  }

  return { init, buildModel, render, captureMap, print };
})();
