// The house tooltip: one fixed speech bubble on <body>, shared by
// every page. Anything with a data-tip gets it on hover or keyboard
// focus. Fixed positioning and a maxed z-index mean it is never
// clipped by a scrolling panel, covered by other elements, or pushed
// off the page - and the tail moves to whichever corner faces the
// control it describes.
(() => {
  const tip = document.createElement("div");
  tip.id = "tipBubble";
  tip.hidden = true;
  document.body.appendChild(tip);

  // House style: custom bubbles, never the browser's native ones
  for (const el of document.querySelectorAll("[title]")) {
    el.dataset.tip = el.getAttribute("title");
    el.removeAttribute("title");
  }

  let tipFor = null;
  const watch = new MutationObserver(() => { if (tipFor) show(tipFor); });

  function show(el) {
    // The anchor can be rebuilt out from under us (the guest rows
    // redraw on every control change) - a detached anchor measures
    // 0,0 and would teleport the bubble to the corner
    if (!el.isConnected) return hide();
    const text = el.dataset.tip;
    if (!text) return hide();
    if (tipFor !== el) {
      watch.disconnect();
      watch.observe(el, { attributes: true, attributeFilter: ["data-tip"] });
    }
    tipFor = el;
    // A tip describing several things carries newline-separated lines
    // and renders as bullets
    tip.textContent = "";
    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length > 1) {
      const ul = document.createElement("ul");
      for (const l of lines) {
        const li = document.createElement("li");
        li.textContent = l;
        ul.appendChild(li);
      }
      tip.appendChild(ul);
    } else {
      tip.textContent = text;
    }
    tip.hidden = false;
    const r = el.getBoundingClientRect();
    const w = tip.offsetWidth, h = tip.offsetHeight;
    const TAIL = 12;
    let x = Math.max(8, Math.min(r.left + r.width / 2 - w / 2, window.innerWidth - w - 8));
    let y = r.top - h - TAIL - 4;
    const below = y < 4;
    if (below) y = Math.min(r.bottom + TAIL + 4, window.innerHeight - h - 8);
    tip.classList.toggle("below", below);
    // The tail sits under (or over) the control it points at, and
    // leans towards the bubble's nearer side - like a speech bubble
    const ax = Math.max(10, Math.min(r.left + r.width / 2 - x - TAIL / 2, w - TAIL - 10));
    tip.classList.toggle("tail-right", ax > w / 2);
    tip.style.left = `${x}px`;
    tip.style.top = `${y}px`;
    tip.style.setProperty("--tail-x", `${ax}px`);
  }

  function hide() {
    tip.hidden = true;
    tipFor = null;
    watch.disconnect();
  }

  document.addEventListener("pointerover", (e) => {
    const el = e.target.closest?.("[data-tip]");
    el ? show(el) : hide();
  });
  document.addEventListener("pointerdown", (e) => {
    // A tap on the control itself keeps the tip (its text may change);
    // tapping anywhere else dismisses it
    if (tipFor && !tipFor.contains(e.target)) hide();
  });
  document.addEventListener("focusin", (e) => {
    const el = e.target.closest?.("[data-tip]");
    if (el && el.matches(":focus-visible")) show(el);
  });
  document.addEventListener("focusout", () => { if (tipFor) hide(); });
  // Scrolling hides rather than repositions: repositioning forced a
  // layout read per scroll frame, and a moving anchor means the user
  // has moved on anyway
  window.addEventListener("scroll", () => hide(), true);
})();
