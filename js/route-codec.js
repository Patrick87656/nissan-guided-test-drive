/**
 * route-codec.js — turns a route into a compact string that fits in a web
 * link (and back), and decides whether an incoming string is safe to load.
 *
 * Link format:  <origin><path>#r=<marker><base64url>
 * (Same format as the internal KPR planner, so its route links open here; an
 * optional vehicle list in them is validated and then ignored.)
 *   marker "d": the JSON is deflate-raw compressed, then base64url encoded
 *   marker "p": plain (uncompressed) JSON, base64url encoded. Used when the
 *               browser has no CompressionStream.
 * The route rides in the URL *fragment* (#...), which browsers never send to
 * a server, so GitHub Pages and anything between never sees it.
 *
 * SECURITY: a link is attacker-controlled input. Everything here is strict
 * and all-or-nothing: the raw hash is length-capped before any decoding, the
 * inflated size is capped WHILE streaming (so a tiny "zip bomb" link can't
 * balloon in memory), the decoded JSON is checked field by field, fresh
 * objects are built (unknown keys never copied), and ANY violation rejects
 * the whole payload with a LinkError. Callers show only a friendly message,
 * never the internal detail. No DOM or Mapbox access at load time.
 */
window.KPR = window.KPR || {};

KPR.codec = (function () {
  const LIMITS = {
    MAX_HASH_CHARS: 100000, // whole location.hash, "#r=" included
    MAX_INFLATED_BYTES: 262144, // 256 KB of JSON after decompression
    MAX_WAYPOINTS: 50,
    MAX_SCENES: 100,
    MAX_NAME: 200, // route name, stop name/detail, scene typeLabel/label
    MAX_NOTES: 2000,
    MAX_VEHICLES: 30, // vehicle names an organizer can list for a route
    MAX_VEHICLE_NAME: 80, // UTF-16 units per vehicle name
  };
  const PREFIX = "#r=";
  const PAYLOAD_VERSION = 1;
  const WAYPOINT_TUPLE_LEN = 4; // [lat, lng, name, detail]
  const SCENE_TUPLE_LEN = 8; // [type, typeLabel, label, notes, startLat, startLng, endLat, endLng]

  /** code: not-link | too-long | bad-encoding | unsupported | too-big | bad-data */
  class LinkError extends Error {
    constructor(code, message) {
      super(message || code);
      this.name = "LinkError";
      this.code = code;
    }
  }

  // C0 control characters except tab, line feed and carriage return.
  const CONTROL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/;
  const CONTROL_RE_G = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g;
  const BASE64URL_RE = /^[A-Za-z0-9_-]*$/;

  function _hasOwn(obj, key) {
    return Object.prototype.hasOwnProperty.call(obj, key);
  }

  function _sceneTypes() {
    const defaults = window.KPR && KPR.scenes && KPR.scenes.DEFAULT_SCENE_COLORS;
    if (!defaults) throw new LinkError("bad-data", "scene types unavailable");
    return defaults;
  }

  // ---------------------------------------------------------------------
  // base64url <-> bytes
  // ---------------------------------------------------------------------

  function _bytesToBase64Url(bytes) {
    let bin = "";
    const CHUNK = 0x8000; // keep String.fromCharCode's argument list small
    for (let i = 0; i < bytes.length; i += CHUNK) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  /** Caller has already checked the charset and length % 4 != 1. */
  function _base64UrlToBytes(text) {
    let b64 = text.replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4 !== 0) b64 += "=";
    let bin;
    try {
      bin = atob(b64);
    } catch (err) {
      throw new LinkError("bad-encoding");
    }
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  // ---------------------------------------------------------------------
  // (De)compression
  // ---------------------------------------------------------------------

  function canCompress() {
    return typeof CompressionStream === "function" && typeof DecompressionStream === "function";
  }

  /**
   * Push `input` through a Compression/DecompressionStream and collect the
   * output. Writing and reading run at the same time (the write is NOT
   * awaited before reading), otherwise stream back-pressure can deadlock.
   * With `maxBytes`, output is counted as it arrives; once it goes over, the
   * stream is cancelled and we reject with "too-big", so a decompression
   * bomb never gets to allocate its full size.
   */
  async function _pump(transform, input, maxBytes) {
    const writer = transform.writable.getWriter();
    const reader = transform.readable.getReader();
    const writing = writer.write(input).then(() => writer.close());
    writing.catch(() => {}); // a failure also surfaces through read(); avoid an unhandled rejection

    const chunks = [];
    let total = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.length;
        if (maxBytes && total > maxBytes) {
          reader.cancel().catch(() => {});
          throw new LinkError("too-big");
        }
        chunks.push(value);
      }
    } catch (err) {
      if (err instanceof LinkError) throw err;
      throw new LinkError("bad-data"); // corrupt or truncated compressed data
    }

    const out = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
      out.set(c, offset);
      offset += c.length;
    }
    return out;
  }

  // ---------------------------------------------------------------------
  // Encoder side
  // ---------------------------------------------------------------------

  /** Cap a string at `max` UTF-16 units (what the decoder checks), drop a
   * trailing lone high surrogate, and remove control characters the decoder
   * would reject. So anything we generate can be read back. */
  function _cap(value, max) {
    let s = value == null ? "" : String(value);
    s = s.replace(CONTROL_RE_G, "");
    if (s.length > max) {
      s = s.slice(0, max);
      const last = s.charCodeAt(s.length - 1);
      if (last >= 0xd800 && last <= 0xdbff) s = s.slice(0, -1);
    }
    return s;
  }

  function _round6(n) {
    return Math.round(n * 1e6) / 1e6;
  }

  const _validCoord = (lat, lng) =>
    typeof lat === "number" &&
    typeof lng === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180;

  /**
   * Clean up a list of vehicle names. The ONE implementation used by the
   * planner box, saved files and share links. Accepts a string (one name per
   * line) or an array; non-strings are dropped. Each name has control
   * characters removed, is trimmed and cut to 80 UTF-16 units (never leaving
   * half a surrogate pair); blanks are dropped, repeats (ignoring upper/lower
   * case) keep their first spelling, and at most 30 names are kept.
   */
  function normalizeVehicles(input) {
    let items = [];
    if (typeof input === "string") items = input.split(/\r\n|\r|\n/);
    else if (Array.isArray(input)) items = input;

    const out = [];
    const seen = new Set();
    for (const raw of items) {
      if (typeof raw !== "string") continue;
      // All C0 controls (tab and line breaks too): a name is a single line.
      const name = _cap(raw.replace(/[\u0000-\u001F]/g, "").trim(), LIMITS.MAX_VEHICLE_NAME).trim();
      if (!name) continue;
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(name);
      if (out.length >= LIMITS.MAX_VEHICLES) break;
    }
    return out;
  }

  /**
   * The compact payload for a route {name, waypoints, scenes}. Carries only
   * what is needed to rebuild it: no routeCoords (the recipient's app
   * recalculates the route) and no savedAt. Scenes carry coordinates only, so
   * the recipient snaps them onto their own fresh route.
   */
  function buildPayload(route) {
    const limits = LIMITS;
    const types = _sceneTypes();
    const w = (route.waypoints || [])
      .filter((p) => p && _validCoord(p.lat, p.lng))
      .map((p) => [
        _round6(p.lat),
        _round6(p.lng),
        _cap(p.name, limits.MAX_NAME),
        _cap(p.detail, limits.MAX_NAME),
      ]);

    const s = [];
    (route.scenes || []).forEach((sc) => {
      // A scene with no usable coordinates can't be placed from a link.
      if (!sc || !_validCoord(sc.startLat, sc.startLng) || !_validCoord(sc.endLat, sc.endLng)) return;
      const type = typeof sc.type === "string" && _hasOwn(types, sc.type) ? sc.type : "Custom";
      let typeLabel = _cap(sc.typeLabel, limits.MAX_NAME);
      if (type !== "Custom") typeLabel = type;
      else if (!typeLabel) typeLabel = "Custom";
      s.push([
        type,
        typeLabel,
        _cap(sc.label, limits.MAX_NAME),
        _cap(sc.notes, limits.MAX_NOTES),
        _round6(sc.startLat),
        _round6(sc.startLng),
        _round6(sc.endLat),
        _round6(sc.endLng),
      ]);
    });

    const payload = { v: PAYLOAD_VERSION, n: _cap(route.name, limits.MAX_NAME), w, s };
    // Optional and absent when empty, so links for routes without a vehicle
    // list are byte-identical to what they were before this field existed.
    const vh = normalizeVehicles(route.vehicles);
    if (vh.length > 0) payload.vh = vh;
    return payload;
  }

  /** Route -> "d<base64url>" or "p<base64url>". Rejects with a LinkError
   * (too-big / too-long) when the route can't be shared as a link. */
  async function encode(route) {
    const payload = buildPayload(route);
    if (payload.w.length > LIMITS.MAX_WAYPOINTS || payload.s.length > LIMITS.MAX_SCENES) {
      throw new LinkError("too-big");
    }
    return _pack(payload, PREFIX.length);
  }

  /** Payload object -> "d<base64url>" or "p<base64url>": JSON, UTF-8, deflate
   * when available, base64url. `prefixLen` is the length of the hash prefix
   * the result will sit behind ("#r="), so the whole-hash cap is checked
   * correctly. */
  async function _pack(obj, prefixLen) {
    const bytes = new TextEncoder().encode(JSON.stringify(obj));
    if (bytes.length > LIMITS.MAX_INFLATED_BYTES) throw new LinkError("too-big");

    let marker = "p";
    let body = bytes;
    if (canCompress()) {
      try {
        body = await _pump(new CompressionStream("deflate-raw"), bytes, 0);
        marker = "d";
      } catch (err) {
        // e.g. 'deflate-raw' unsupported by this browser's CompressionStream.
        marker = "p";
        body = bytes;
      }
    }
    const encoded = marker + _bytesToBase64Url(body);
    if (encoded.length > LIMITS.MAX_HASH_CHARS - prefixLen) throw new LinkError("too-long");
    return encoded;
  }

  // ---------------------------------------------------------------------
  // Decoder side
  // ---------------------------------------------------------------------

  function _isPlainObject(v) {
    if (v === null || typeof v !== "object" || Array.isArray(v)) return false;
    const proto = Object.getPrototypeOf(v);
    return proto === Object.prototype || proto === null;
  }

  function _str(v, max) {
    if (typeof v !== "string" || v.length > max || CONTROL_RE.test(v)) throw new LinkError("bad-data");
    return v;
  }

  function _num(v, limit) {
    if (typeof v !== "number" || !Number.isFinite(v) || Math.abs(v) > limit) throw new LinkError("bad-data");
    return v;
  }

  /**
   * Check a parsed payload against the limits and return the normalized route
   * {name, waypoints:[{lat,lng,name,detail}], scenes:[{type,typeLabel,label,
   * notes,startLat,startLng,endLat,endLng}]}. Throws LinkError("bad-data") on
   * the first violation; nothing is ever partially accepted.
   */
  function validatePayload(obj) {
    if (!_isPlainObject(obj) || obj.v !== PAYLOAD_VERSION) throw new LinkError("bad-data");
    const types = _sceneTypes();
    const name = _str(obj.n, LIMITS.MAX_NAME);

    if (!Array.isArray(obj.w) || obj.w.length < 1 || obj.w.length > LIMITS.MAX_WAYPOINTS) {
      throw new LinkError("bad-data");
    }
    const waypoints = obj.w.map((t) => {
      if (!Array.isArray(t) || t.length !== WAYPOINT_TUPLE_LEN) throw new LinkError("bad-data");
      return {
        lat: _num(t[0], 90),
        lng: _num(t[1], 180),
        name: _str(t[2], LIMITS.MAX_NAME),
        detail: _str(t[3], LIMITS.MAX_NAME),
      };
    });

    const rawScenes = obj.s === undefined ? [] : obj.s;
    if (!Array.isArray(rawScenes) || rawScenes.length > LIMITS.MAX_SCENES) throw new LinkError("bad-data");
    const scenes = rawScenes.map((t) => {
      if (!Array.isArray(t) || t.length !== SCENE_TUPLE_LEN) throw new LinkError("bad-data");
      if (typeof t[0] !== "string" || !_hasOwn(types, t[0])) throw new LinkError("bad-data");
      const type = t[0];
      let typeLabel = _str(t[1], LIMITS.MAX_NAME);
      if (type === "Custom" && typeLabel === "") throw new LinkError("bad-data");
      if (type !== "Custom") typeLabel = type;
      return {
        type,
        typeLabel,
        label: _str(t[2], LIMITS.MAX_NAME),
        notes: _str(t[3], LIMITS.MAX_NOTES),
        startLat: _num(t[4], 90),
        startLng: _num(t[5], 180),
        endLat: _num(t[6], 90),
        endLng: _num(t[7], 180),
      };
    });

    const route = { name, waypoints, scenes };

    // Optional vehicle list. Strict about shape, forgiving about blanks and
    // repeats (those are normalized away rather than rejected).
    if (obj.vh !== undefined) {
      if (!Array.isArray(obj.vh) || obj.vh.length > LIMITS.MAX_VEHICLES) throw new LinkError("bad-data");
      const vehicles = normalizeVehicles(obj.vh.map((v) => _str(v, LIMITS.MAX_VEHICLE_NAME)));
      if (vehicles.length > 0) route.vehicles = vehicles;
    }
    return route;
  }

  /** "d…"/"p…" -> validated route. Every failure is a LinkError. */
  async function decode(encoded) {
    try {
      return validatePayload(await _unpack(encoded));
    } catch (err) {
      throw err instanceof LinkError ? err : new LinkError("bad-data");
    }
  }

  /** "d…"/"p…" -> the parsed JSON value, NOT yet validated (the caller runs
   * the matching validator). Does the marker, charset, length, inflate (with
   * the streaming size cap) and strict UTF-8 / JSON steps. Throws LinkError. */
  async function _unpack(encoded) {
    if (typeof encoded !== "string") throw new LinkError("not-link");
    if (encoded.length > LIMITS.MAX_HASH_CHARS) throw new LinkError("too-long");
    if (encoded.length < 1) throw new LinkError("bad-encoding");

    const marker = encoded.charAt(0);
    if (marker !== "d" && marker !== "p") throw new LinkError("bad-encoding");
    const body = encoded.slice(1);
    if (!BASE64URL_RE.test(body) || body.length % 4 === 1) throw new LinkError("bad-encoding");

    let bytes = _base64UrlToBytes(body);
    if (marker === "d") {
      if (!canCompress()) throw new LinkError("unsupported");
      bytes = await _pump(new DecompressionStream("deflate-raw"), bytes, LIMITS.MAX_INFLATED_BYTES);
    } else if (bytes.length > LIMITS.MAX_INFLATED_BYTES) {
      throw new LinkError("too-big");
    }

    let parsed;
    try {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      parsed = JSON.parse(text);
    } catch (err) {
      throw new LinkError("bad-data");
    }
    return parsed;
  }

  /** location.hash -> the encoded string after "#r=", or null when the hash
   * isn't a share link. Throws LinkError("too-long") for an oversized hash,
   * before anything is decoded. */
  function parseHash(hash) {
    if (typeof hash !== "string" || !hash.startsWith(PREFIX)) return null;
    if (hash.length > LIMITS.MAX_HASH_CHARS) throw new LinkError("too-long");
    return hash.slice(PREFIX.length);
  }

  /** The shareable URL. The route goes in the fragment, never the query
   * string. `loc` is only a seam for tests. */
  function buildLink(encoded, loc) {
    const l = loc || window.location;
    return l.origin + l.pathname + PREFIX + encoded;
  }

  return {
    LIMITS,
    LinkError,
    canCompress,
    normalizeVehicles,
    buildPayload,
    encode,
    decode,
    validatePayload,
    parseHash,
    buildLink,
  };
})();
