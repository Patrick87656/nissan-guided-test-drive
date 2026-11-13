/**
 * voice-prefs.js — the "Read highlight notes aloud" setting.
 *
 * In the car the customer drives and the salesperson rides along. With the
 * setting ON (the default) Drive mode speaks a highlight's name AND its notes
 * when the highlight starts. With it OFF only the name is spoken ("Highway
 * merge") and the notes stay on screen, so the salesperson can say them in
 * their own words instead of the app reading the script to the customer.
 * Turn-by-turn directions are not affected (the round voice button in Drive
 * mode still mutes everything).
 *
 * The choice is remembered on this device (localStorage key ngtdSpeakNotes,
 * "1" / "0"); anything unreadable counts as the default.
 */
window.KPR = window.KPR || {};

KPR.voicePrefs = (function () {
  const STORAGE_KEY = "ngtdSpeakNotes";
  const DEFAULT_SPEAK_NOTES = true;

  let store = null; // null = window.localStorage (tests swap in a fake)

  function _storage() {
    if (store) return store;
    try {
      return window.localStorage;
    } catch (err) {
      return null; // blocked storage (some private modes) -> just use the default
    }
  }

  function getSpeakNotes() {
    try {
      const s = _storage();
      const v = s ? s.getItem(STORAGE_KEY) : null;
      if (v === "1") return true;
      if (v === "0") return false;
    } catch (err) {
      // fall through to the default
    }
    return DEFAULT_SPEAK_NOTES;
  }

  function setSpeakNotes(on) {
    try {
      const s = _storage();
      if (s) s.setItem(STORAGE_KEY, on ? "1" : "0");
    } catch (err) {
      // Storage full or blocked: the checkbox still works for this page.
    }
  }

  /** What Drive mode says when a highlight starts. Pure. */
  function startAnnouncement(typeLabel, label, notes, speakNotes) {
    const head = `${typeLabel || "Highlight"}: ${label || ""}.`;
    if (!speakNotes) return head;
    return notes ? `${head} ${notes}` : head;
  }

  /** Test seam: use `obj` (getItem/setItem) instead of localStorage; null to go back. */
  function useStorage(obj) {
    store = obj || null;
  }

  function init() {
    const box = document.getElementById("speak-notes");
    if (!box) return;
    box.checked = getSpeakNotes();
    box.addEventListener("change", () => setSpeakNotes(box.checked));
  }

  return { init, getSpeakNotes, setSpeakNotes, startAnnouncement, useStorage, STORAGE_KEY };
})();
