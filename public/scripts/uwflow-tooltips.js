/**
 * UWFlow rating tooltips on the results page.
 *
 * One delegated listener rather than a Tooltip instance per link: a results
 * page lists every remaining option for every requirement, which can be
 * hundreds of anchors, and building them all up front blocked the main thread
 * on load. Tooltips are created the first time a course is actually hovered or
 * focused.
 */
(function () {
  "use strict";

  if (typeof bootstrap === "undefined" || !bootstrap.Tooltip) return;

  /** @type {Map<string, Promise<any>>} */
  var pending = new Map();
  /** @type {Map<string, any>} */
  var loaded = new Map();

  function percent(value) {
    return typeof value === "number" ? Math.round(value * 100) + "%" : "n/a";
  }

  function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, function (character) {
      return {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      }[character];
    });
  }

  function render(data) {
    if (!data) return "No UWFlow data for this course";
    if (data.filledCount === 0) {
      return "<strong>" + escapeHtml(data.name) + "</strong><br>No ratings yet";
    }
    return (
      "<strong>" +
      escapeHtml(data.name) +
      "</strong><br>" +
      "👍 Liked: " + percent(data.liked) + "<br>" +
      "🧠 Useful: " + percent(data.useful) + "<br>" +
      "😌 Easy: " + percent(data.easy) + "<br>" +
      "👥 Ratings: " + data.filledCount
    );
  }

  function fetchCourse(code) {
    if (loaded.has(code)) return Promise.resolve(loaded.get(code));

    var inFlight = pending.get(code);
    if (inFlight) return inFlight;

    var request = fetch("/api/uwflow/course/" + encodeURIComponent(code))
      .then(function (response) {
        if (!response.ok) throw new Error("HTTP " + response.status);
        return response.json();
      })
      .then(function (data) {
        loaded.set(code, data);
        pending.delete(code);
        return data;
      })
      .catch(function () {
        // Deliberately not cached: a transient failure used to pin a course to
        // "no data" for the rest of the session, with no way to retry.
        pending.delete(code);
        return null;
      });

    pending.set(code, request);
    return request;
  }

  function tooltipFor(element) {
    return (
      bootstrap.Tooltip.getInstance(element) ||
      new bootstrap.Tooltip(element, {
        html: true,
        trigger: "manual",
        title: "Loading UWFlow data…",
        container: "body",
      })
    );
  }

  function show(element) {
    var code = element.getAttribute("data-code");
    if (!code) return;

    var tooltip = tooltipFor(element);
    tooltip.show();

    fetchCourse(code).then(function (data) {
      // The pointer may have moved on while the request was in flight.
      if (!element.matches(":hover") && document.activeElement !== element) return;
      tooltip.setContent({ ".tooltip-inner": render(data) });
    });
  }

  function hide(element) {
    var tooltip = bootstrap.Tooltip.getInstance(element);
    if (tooltip) tooltip.hide();
  }

  function bind(eventName, handler) {
    // Focus and blur do not bubble, so delegation uses the capture phase —
    // this is what makes the tooltips reachable by keyboard.
    document.addEventListener(
      eventName,
      function (event) {
        var target = event.target.closest ? event.target.closest(".course-code") : null;
        if (target) handler(target);
      },
      true,
    );
  }

  bind("mouseover", show);
  bind("focusin", show);
  bind("mouseout", hide);
  bind("focusout", hide);
})();
