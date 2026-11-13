/**
 * open-link.js - "Open a shared link": paste a route link (#r=...) into the
 * app and open it.
 *
 * Why this exists: scanning a QR code or tapping a link always opens the
 * phone's browser, never the installed home-screen app (iOS and Android don't
 * let a web app claim links). So in the installed app a person opens the app
 * first, taps "Open a shared link", pastes the link, and it loads in the
 * clean full-screen view.
 *
 * This module does NOT parse or trust the link itself. It only pulls the
 * "#r=..." fragment out of whatever was pasted and sets location.hash to it.
 * That fires the same hashchange handler a scanned or tapped link goes
 * through (KPR.share.loadFromHash), which already validates everything, caps
 * sizes, confirms before replacing stops, and shows a friendly message for a
 * bad link.
 *
 * The pasted text is only ever put into the DOM through .value / .textContent.
 */
window.KPR = window.KPR || {};

KPR.openLink = (function () {
  // Same ceiling the codec enforces on a whole location.hash, so we refuse an
  // absurd paste before even touching location.
  const MAX_PASTE_CHARS = 100000;
  const BAD_MSG = "That doesn't look like a test drive route link. Copy the whole link and try again.";

  const $ = (id) => document.getElementById(id);
  let lastFocus = null;

  /**
   * Pasted text -> the "#r=..." fragment, or null.
   * Accepts a full URL, a bare fragment, or a link with words around it
   * (chat apps often add some). The fragment ends at the first character that
   * isn't base64url, so trailing text or punctuation is never pulled in.
   * Results links (#res=..., from the internal KPR planner) are not accepted:
   * this app has no results view. Pure function, exported for tests.
   */
  function extractHash(text) {
    if (typeof text !== "string") return null;
    if (text.length > MAX_PASTE_CHARS + 2000) return null; // wildly too big
    const m = /#r=([A-Za-z0-9_-]+)/.exec(text);
    if (!m) return null;
    const hash = "#r=" + m[1];
    if (hash.length > MAX_PASTE_CHARS) return null;
    return hash;
  }

  function _setMessage(text) {
    const el = $("open-link-msg");
    el.textContent = text || "";
    el.classList.toggle("hidden", !text);
  }

  function open() {
    lastFocus = document.activeElement;
    $("open-link-input").value = "";
    _setMessage("");
    $("open-link-dialog").classList.remove("hidden");
    $("open-link-input").focus();
  }

  function close() {
    $("open-link-dialog").classList.add("hidden");
    if (lastFocus && typeof lastFocus.focus === "function") lastFocus.focus();
    lastFocus = null;
  }

  function isOpen() {
    return !$("open-link-dialog").classList.contains("hidden");
  }

  /** Read the clipboard into the box (needs a tap; iOS shows a Paste bubble). */
  async function paste() {
    try {
      const text = await navigator.clipboard.readText();
      $("open-link-input").value = text;
      _setMessage(extractHash(text) ? "" : BAD_MSG);
    } catch (err) {
      // Blocked or unsupported: the person can long-press the box and Paste.
      _setMessage("Couldn't read the clipboard. Press and hold in the box, then choose Paste.");
      $("open-link-input").focus();
    }
  }

  /** Hand the link to the existing loaders by setting the address fragment. */
  function submit() {
    const hash = extractHash($("open-link-input").value);
    if (!hash) {
      _setMessage(BAD_MSG);
      return;
    }
    close();
    if (location.hash === hash) {
      // Same fragment as already in the address: no hashchange would fire.
      // Clear it first so setting it again triggers the loader.
      history.replaceState(null, "", location.pathname + location.search);
    }
    location.hash = hash;
  }

  function _trapTab(e) {
    const focusable = Array.from(
      $("open-link-dialog").querySelectorAll("button, textarea, input")
    ).filter((el) => !el.disabled && el.offsetParent !== null);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  function init() {
    const trigger = $("open-link-btn");
    if (!trigger) return;
    trigger.addEventListener("click", open);
    $("open-link-close").addEventListener("click", close);
    $("open-link-paste").addEventListener("click", paste);
    $("open-link-go").addEventListener("click", submit);
    $("open-link-dialog").addEventListener("click", (e) => {
      if (e.target === $("open-link-dialog")) close(); // backdrop, not the box
    });
    $("open-link-input").addEventListener("input", () => _setMessage(""));
    document.addEventListener("keydown", (e) => {
      if (!isOpen()) return;
      if (e.key === "Escape") close();
      else if (e.key === "Tab") _trapTab(e);
    });
  }

  return { init, extractHash, open, close, isOpen };
})();
