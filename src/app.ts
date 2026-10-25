import "./style.css";
import { brushFromInput, captureStroke, clearMakeup, defaultBrush, encodeLook, identityFromInput, lookFingerprint, newLook, palette, regions, themes, toolRegion, tools } from "./look";
import { avatarCatalog, avatarFields, avatarLabels } from "./avatar";
import type { AvatarChoice } from "./avatar";
import type { Brush, Criterion, Look, ThemeId, ToolId, UV } from "./look";
import { createSession, presentSession, step } from "./session";
import type { Action, Framing, Mode, Navigation, Session } from "./session";
import type { AppearanceAvailability, Portrait } from "./portrait";
import { decodeShare, encodeShare, lookbookKey, lookbookLimits, readLookbook, removeSavedLook, saveLook } from "./lookbook";
import type { SavedLook, StoragePort } from "./lookbook";

const motif = '<svg viewBox="0 0 64 64" fill="none" aria-hidden="true"><path d="M32 3c2 19 9 26 29 29-20 3-27 10-29 29C30 42 23 35 3 32 23 29 30 22 32 3Z" fill="currentColor"/><path d="M32 19v26M19 32h26" stroke="var(--paper)" stroke-width="1.5"/><circle cx="32" cy="32" r="3" fill="var(--paper)"/></svg>';
const icons: Record<ToolId, string> = {
  blush: '<path d="m9 14 2-7h4l2 7M8 14h10v6H8zM12 3h2"/><path d="M6 10 4 8m16 2 2-2"/>',
  shadow: '<path d="M3 13s3-6 9-6 9 6 9 6-3 5-9 5-9-5-9-5Z"/><path d="M5 9c4-5 10-5 14 0"/><path d="M9 12h6"/>',
  lipstick: '<path d="M8 13h8v8H8zM9 13V7l6-4v10M7 21h10M9 7h6"/>',
  liner: '<path d="m5 17 12-12 3 3L8 20l-5 1 2-4ZM15 7l3 3M5 17l3 3"/>',
  sparkle: '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3ZM20 2v4m-2-2h4"/>',
  erase: '<path d="m4 13 9-9 8 8-9 9H8l-4-4v-4ZM9 8l8 8M12 21h9"/>',
  blend: '<path d="M12 3c0 5-6 7-6 12a6 6 0 0 0 12 0c0-5-6-7-6-12Z"/><path d="M9 16c0 2 2 3 4 2"/>',
};
const arrow = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 12h15m-6-6 6 6-6 6"/></svg>';
const toolIds = Object.keys(tools) as ToolId[];
const themeIds = Object.keys(themes) as ThemeId[];
const app = document.querySelector<HTMLDivElement>("#app");
if (app === null) throw new Error("The application root is missing.");

app.innerHTML = `
  <a class="skip-link" href="#portrait-canvas">Skip to the portrait</a>
  <header class="site-header">
    <div class="topline"><span>THE VIRTUAL MAKEUP ATELIER</span><span>A LITTLE COLOR. A NEW POINT OF VIEW.</span><button class="text-button" id="help-button">How to play <span aria-hidden="true">↗</span></button></div>
    <div class="masthead">
      <div class="brand"><h1 aria-label="MAKE1UP">MAKE<span class="brand-one">1</span>UP<span class="brand-motif">${motif}</span></h1><p>Make a face. Make a statement.</p></div>
      <div class="header-actions" aria-label="Your looks">
        <button class="quiet-button" id="lookbook-button" aria-label="Open lookbook"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 4h7v16H4zM11 4h9v16h-9M7 8h1m6 0h3m-3 4h3"/></svg>Lookbook <span id="saved-count" class="count">0</span></button>
        <button class="quiet-button" id="save-button" aria-label="Save look"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 3h12v18l-6-4-6 4V3Z"/></svg><span>Save look</span></button>
        <button class="quiet-button" id="share-button" aria-label="Share look"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m9 15 6-6m-8 4-2 2a3.5 3.5 0 0 0 5 5l3-3m-2-10 3-3a3.5 3.5 0 0 1 5 5l-2 2"/></svg><span>Share</span></button>
        <button class="outline-button" id="download-button" aria-label="Download PNG"><span>Download PNG</span><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4"/></svg></button>
      </div>
    </div>
  </header>
  <main class="studio-shell" id="studio" data-workspace="makeup">
    <header class="customization-header" id="customization-header" hidden><h2 id="customization-heading" tabindex="-1">Customize portrait</h2><p id="customization-clock">No timer</p></header>
    <aside class="tool-rail" aria-label="Makeup tools">
      <h2 class="eyebrow rail-heading">01 <span>/</span> TOOLS</h2>
      <div class="tool-list">${toolIds.map((id, index) => `<button class="tool-button" data-tool="${id}" aria-label="${tools[id].label}" aria-pressed="false" title="${tools[id].label} · ${index + 1}"><span class="tool-icon"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true">${icons[id]}</svg></span><span>${tools[id].label}</span><kbd>${index + 1}</kbd></button>`).join("")}</div>
      <div class="rail-signature" aria-hidden="true">${motif}<span>MAKE<br>IT YOURS.</span></div>
    </aside>
    <section class="work-area" aria-label="Portrait studio">
      <div class="brief-bar">
        <p class="eyebrow" id="mode-label">THE BRIEF / SOLO CHALLENGE</p>
        <div class="brief-actions"><h2><button class="change-brief" id="brief-button" aria-label="Change brief"><span id="theme-title">Orchid hour</span><span class="brief-change-label">Change brief ${arrow}</span></button></h2><button class="outline-button" id="customize-button">Customize portrait</button></div>
        <p id="theme-brief">${themes["orchid-hour"].brief}</p>
      </div>
      <div class="stage" id="portrait-stage" data-state="loading">
        <div class="cover-type" aria-hidden="true"><span class="cover-kicker">THE COLOR ISSUE</span><span class="cover-title" id="cover-title">Orchid<br><em>hour.</em></span></div>
        <canvas id="portrait-canvas" aria-label="3D makeup portrait" aria-describedby="canvas-help" tabindex="0"></canvas>
        <div class="stage-top-controls">
          <div class="segmented navigation-switch" aria-label="Canvas interaction"><button data-navigation="paint" aria-pressed="true">Paint</button><button data-navigation="turn" aria-pressed="false">Turn</button></div>
          <button class="mirror-button" id="mirror-button" aria-pressed="true"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3v18M9 6l-6 6 6 6V6Zm6 0 6 6-6 6V6Z"/></svg><span>Mirror on</span></button>
        </div>
        <div class="stage-side-note" aria-hidden="true">AN ORIGINAL LOOK BY YOU</div>
        <div class="cover-footer" aria-hidden="true"><span>BE YOUR<br><em>own muse.</em></span><span class="cover-number" id="cover-number">N° 01</span></div>
        <div class="stage-message" id="stage-message" role="status"><span class="loading-motif">${motif}</span><h3 id="stage-message-title">A fresh face, just a moment.</h3><p id="stage-message-copy">Loading the 3D portrait and your makeup tools.</p><button class="outline-button" id="retry-button" hidden>Try again</button></div>
        <div class="reveal-note" id="reveal-note" hidden role="status">Your cover is ready.</div>
        <span class="before-badge" id="before-badge" hidden>BEFORE / NO MAKEUP</span>
        <button class="stage-credit" id="stage-credits" aria-label="Portrait asset credit">Portrait credit <span aria-hidden="true">↗</span></button>
      </div>
      <div class="view-bar">
        <p class="inspection-hint" id="inspection-hint" hidden>Drag to turn</p>
        <div class="framing-controls" aria-label="Portrait framing"><button data-frame="face" aria-pressed="true">Face</button><button data-frame="eyes" aria-pressed="false">Eyes</button><button data-frame="lips" aria-pressed="false">Lips</button></div>
        <div class="view-actions"><button class="before-button" id="before-button" aria-pressed="false">Before / after</button><span class="view-divider"></span><button class="icon-button" id="zoom-out" aria-label="Zoom out">−</button><button class="icon-button" id="zoom-in" aria-label="Zoom in">+</button></div>
      </div>
      <div class="canvas-caption"><p id="canvas-help">Choose a color. Paint the face.</p><span id="gesture-count">0 gestures</span></div>
      <div class="finish-bar" id="finish-bar"><div class="round-status"><span class="status-dot" aria-hidden="true"></span><div><span id="clock-label">AT YOUR OWN PACE</span><p id="clock">No timer · solo brief match</p></div></div><button class="primary-button" id="finish-button">Finish look ${arrow}</button></div>
    </section>
    <aside class="cosmetics-panel" aria-label="Cosmetics and brush settings">
      <section id="editor-panel">
        <div class="panel-title"><p class="eyebrow">02 / THE PALETTE</p><h2 id="active-tool">Blush</h2><p class="tool-description" id="tool-description">A soft wash of color anywhere on the paintable face.</p></div>
        <fieldset class="color-section"><legend>COLOR STORY</legend><div class="swatch-list">${Object.values(palette).map((entry) => `<button class="swatch" data-color="${entry.color}" aria-label="${entry.label} color" aria-pressed="false" title="${entry.label}" style="--swatch:${entry.color}"><span></span></button>`).join("")}</div><div class="custom-color-row"><span id="color-name">Rose</span><label class="custom-color">Custom color <input type="color" id="custom-color" aria-label="Custom makeup color" value="#cc5075"><span class="custom-color-icon" aria-hidden="true">+</span></label></div></fieldset>
        <fieldset class="brush-section"><legend>THE FINER DETAILS</legend>
          <label class="range-control" for="brush-size"><span>Brush size</span><output id="brush-size-value" data-brush-value="size" for="brush-size">4.5%</output><input id="brush-size" data-brush="size" aria-label="Brush size" type="range" min="0.003" max="0.08" step="0.001" value="0.045"></label>
          <label class="range-control" for="brush-opacity"><span id="brush-opacity-label">Opacity</span><output id="brush-opacity-value" data-brush-value="opacity" for="brush-opacity">55%</output><input id="brush-opacity" data-brush="opacity" aria-label="Opacity" type="range" min="0" max="1" step="0.01" value="0.55"></label>
          <label class="range-control" for="brush-softness"><span>Softness</span><output id="brush-softness-value" data-brush-value="softness" for="brush-softness">85%</output><input id="brush-softness" data-brush="softness" aria-label="Softness" type="range" min="0" max="1" step="0.01" value="0.85"></label>
          <label class="range-control" for="brush-finish"><span>Gloss</span><output id="brush-finish-value" data-brush-value="finish" for="brush-finish">0%</output><input id="brush-finish" data-brush="finish" aria-label="Gloss" type="range" min="0" max="1" step="0.01" value="0"></label>
        </fieldset>
        <div class="guided-section" id="guided-section" hidden><button class="guided-button" id="guided-button">Guided apply ${arrow}</button><p id="guided-description">A little help with placement.</p></div>
        <div class="correction-bar" id="correction-bar" aria-label="Brush and correction">
          <div class="quick-brush"><div class="quick-tool"><strong id="quick-active-tool">Blush</strong><span id="allowed-region">Anywhere on the paintable face</span></div><label class="range-control quick-size" for="quick-brush-size"><span>Size</span><output id="quick-brush-size-value" data-brush-value="size" for="quick-brush-size">4.5%</output><input id="quick-brush-size" data-brush="size" aria-label="Quick brush size" type="range" min="0.003" max="0.08" step="0.001" value="0.045"></label></div>
          <div class="history-controls"><button id="undo-button" aria-label="Undo last edit" title="Undo · Ctrl Z">↶ <span>Undo</span></button><button id="redo-button" aria-label="Redo last edit" title="Redo · Ctrl Shift Z">↷ <span>Redo</span></button><button id="clear-button">Clear</button></div>
        </div>
      </section>
      <section class="result-panel" id="result-panel" aria-label="Finished look" hidden><p class="eyebrow">THE FINAL LOOK</p><h2 id="result-heading" tabindex="-1">That's your<br><em>cover.</em></h2><div id="result-summary"></div><div id="result-evidence"></div><div class="result-actions"><button class="primary-button" id="next-button">Next brief ${arrow}</button><button class="outline-button" id="remix-button">Remix this look</button><button class="text-button" id="replay-button">Replay with clean skin</button></div></section>
      <div class="panel-colophon"><span class="mini-motif" aria-hidden="true">${motif}</span><p>A makeup playground.<br>A look only you could make.</p></div>
    </aside>
    <aside class="customization-controls" id="customization-controls" aria-label="Portrait appearance" hidden><p class="appearance-intro">Your makeup stays in place. Each choice is one edit.</p><p class="appearance-status" id="appearance-status" role="status" aria-live="polite">Portrait ready.</p><p class="customization-notice" id="customization-notice" role="status" hidden></p><div id="appearance-fields"></div></aside>
    <footer class="customization-footer" id="customization-footer" hidden><div class="customization-history"><button id="customization-undo" aria-label="Undo last edit">↶ <span>Undo</span></button><button id="customization-redo" aria-label="Redo last edit">↷ <span>Redo</span></button></div><p>Changes apply as you choose.</p><button class="primary-button" id="customization-done">Done</button></footer>
  </main>
  <footer class="site-footer"><span>MAKE1UP © 2026</span><span>MAKEUP IS AN EXPERIMENT. NOT A BEAUTY SCORE.</span><button class="text-button credit-button" id="credits-button">Portrait & font credits <span aria-hidden="true">↗</span></button></footer>
  <div class="toast" id="toast" hidden><p role="status" aria-live="polite" aria-atomic="true" id="app-status"></p><button class="icon-button" id="dismiss-toast" aria-label="Dismiss message">×</button></div>
  <dialog id="brief-dialog" class="editorial-dialog brief-dialog" aria-labelledby="brief-dialog-title"><form id="brief-form"><div class="dialog-top"><span class="eyebrow">A NEW DIRECTION</span><button type="button" class="icon-button" data-close aria-label="Close brief selection">×</button></div><h2 id="brief-dialog-title">Find your<br><em>next look.</em></h2><p class="dialog-intro">Your makeup stays. Choose a brief, or practice without a score.</p><fieldset class="theme-options"><legend class="sr-only">Choose a theme</legend>${themeIds.map((id, index) => `<label class="theme-option"><input type="radio" name="theme" value="${id}" ${index === 0 ? "checked" : ""}><span><strong>${themes[id].title}</strong><small>${themes[id].brief}</small></span><span class="theme-number" aria-hidden="true">0${index + 1}</span></label>`).join("")}</fieldset><div class="mode-options"><label for="round-mode">Your session<select id="round-mode"><option value="challenge">Solo brief match</option><option value="practice">Practice, no score</option></select></label><label for="round-duration">Optional timer<select id="round-duration"><option value="0">No timer</option><option value="3">3 minutes</option><option value="5">5 minutes</option></select></label></div><p class="small-copy" id="timer-note">A timed round starts when you apply this brief. Finishing locks the look.</p><details class="criteria-details"><summary>How a brief match works</summary><p>Only the final makeup is measured. There are no votes or random points. The portrait's skin, eyes, and hair do not affect the result.</p><ul id="brief-rules"></ul><p>At least 0.5% face coverage is needed before any points count. Erased paint earns nothing.</p></details><button type="submit" class="primary-button wide-button">Apply brief ${arrow}</button></form></dialog>
  <dialog id="clear-dialog" class="editorial-dialog small-dialog" aria-labelledby="clear-title"><div class="dialog-top"><span class="eyebrow">A CLEAN CANVAS</span><button class="icon-button" data-close aria-label="Close clear confirmation">×</button></div><h2 id="clear-title">Start with<br><em>clean skin?</em></h2><p>Your makeup will be removed. Your portrait styling stays. You can undo this action.</p><div class="dialog-actions"><button class="outline-button" data-close>Keep makeup</button><button class="primary-button" id="confirm-clear">Clear makeup</button></div></dialog>
  <dialog id="lookbook-dialog" class="editorial-dialog lookbook-dialog" aria-labelledby="lookbook-title"><div class="dialog-top"><span class="eyebrow">SAVED IN THIS BROWSER</span><button class="icon-button" data-close aria-label="Close lookbook">×</button></div><h2 id="lookbook-title">Your <em>lookbook.</em></h2><p class="dialog-intro">Up to eight looks, saved on this device. Open a look to keep painting.</p><div id="lookbook-content"></div></dialog>
  <dialog id="remove-dialog" class="editorial-dialog small-dialog" aria-labelledby="remove-title"><div class="dialog-top"><span class="eyebrow">YOUR LOOKBOOK</span><button class="icon-button" data-close aria-label="Close removal confirmation">×</button></div><h2 id="remove-title">Remove this<br><em>saved look?</em></h2><p id="remove-description"></p><div class="dialog-actions"><button class="outline-button" data-close>Keep saved look</button><button class="primary-button" id="confirm-remove">Remove saved look</button></div></dialog>
  <dialog id="share-dialog" class="editorial-dialog small-dialog" aria-labelledby="share-title"><div class="dialog-top"><span class="eyebrow">PASS THE COLOR ON</span><button class="icon-button" data-close aria-label="Close share link">×</button></div><h2 id="share-title">Made to<br><em>be remixed.</em></h2><p>This private link contains your actual makeup and portrait styling. Anyone with it can open and remix the look. Nothing is uploaded.</p><label class="share-label" for="share-url">Private remix link</label><textarea id="share-url" readonly rows="3" spellcheck="false"></textarea><button class="primary-button wide-button" id="copy-link">Copy link ${arrow}</button><p class="small-copy">A complex look may be too large for a link. PNG download is always available.</p></dialog>
  <dialog id="help-dialog" class="editorial-dialog small-dialog" aria-labelledby="help-title"><div class="dialog-top"><span class="eyebrow">YOUR FIRST MARK</span><button class="icon-button" data-close aria-label="Close help">×</button></div><h2 id="help-title">A face is<br><em>your canvas.</em></h2><ol class="help-steps"><li><strong>Choose a tool and a color.</strong> Every tool works anywhere on the paintable face except lipstick, which stays on the lips.</li><li><strong>Paint the face.</strong> Drag with a mouse or a finger. Mirror paints both sides. Guided apply uses the portrait's landmarks.</li><li><strong>Find your angle.</strong> Turn rotates the portrait without painting. Use Face, Eyes, or Lips to get closer.</li><li><strong>Make it a cover.</strong> Finish locks your look. See your brief match, or finish practice without a score.</li></ol><p class="small-copy">Keyboard. Keys 1 to 7 choose tools. Ctrl Z or ⌘ Z undoes an edit. Add Shift to redo. Escape closes a dialog. All controls work with Tab and Enter.</p><button class="primary-button wide-button" data-close>Let's make a look ${arrow}</button></dialog>
  <dialog id="credits-dialog" class="editorial-dialog small-dialog" aria-labelledby="credits-title"><div class="dialog-top"><span class="eyebrow">THE PEOPLE BEHIND THE PORTRAIT</span><button class="icon-button" data-close aria-label="Close credits">×</button></div><h2 id="credits-title">Made with<br><em>good company.</em></h2><h3>Rain portrait</h3><p>Rain Rig (CC) Blender Foundation | <a href="https://studio.blender.org/characters/rain/" target="_blank" rel="noopener noreferrer">studio.blender.org</a>.</p><p>This is a modified, licensed Rain derivative. It is not AI-generated. The export, material conversion, crop, fitted seam, brows, ponytail, catchlights, iris recolors, paint UVs, and masks were prepared for MAKE1UP. Blender Foundation does not endorse this project.</p><p>Licensed under <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener noreferrer">Creative Commons Attribution 4.0</a>. <a href="${import.meta.env.BASE_URL}face/v2/CREDITS.txt" target="_blank" rel="noopener">Full portrait credit</a>.</p><h3>Local typefaces</h3><p>Bodoni Moda by indestructible type* and DM Sans by Colophon Foundry and contributors. Both use the SIL Open Font License. <a href="${import.meta.env.BASE_URL}fonts/Bodoni-Moda-OFL.txt" target="_blank" rel="noopener">Bodoni Moda license</a>. <a href="${import.meta.env.BASE_URL}fonts/DM-Sans-OFL.txt" target="_blank" rel="noopener">DM Sans license</a>.</p></dialog>
`;

function query<T extends Element = HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (element === null) throw new Error(`Missing application element ${selector}`);
  return element;
}

function isKey<T extends object>(object: T, value: unknown): value is keyof T {
  return typeof value === "string" && Object.hasOwn(object, value);
}

const canvas = query<HTMLCanvasElement>("#portrait-canvas");
const storage: StoragePort = {
  getItem: (key) => window.localStorage.getItem(key),
  setItem: (key, value) => window.localStorage.setItem(key, value),
};
let selectedTheme: ThemeId = "orchid-hour";
let selectedKind: Mode["kind"] = "challenge";
let selectedDuration: 0 | 3 | 5 = 0;
let session: Session = createSession(newLook(), { kind: "challenge", theme: selectedTheme, deadline: null });
session = step(session, { type: "brush", brush: { ...defaultBrush(), mirror: true } });
let portrait: Portrait | null = null;
let portraitState: "loading" | "ready" | "error" = "loading";
let round = 1;
let revision = 0;
let before = false;
let makeupScroll: Readonly<{ x: number; y: number }> | null = null;
let timer: number | undefined;
let revealTimer: number | undefined;
let toastTimer: number | undefined;
let lastNotice: string | null = null;
let loadRequest = 0;
let jobCounter = 0;
let removeId: string | null = null;
let captureTail: Promise<void> = Promise.resolve();
const jobs = new Map<string, number>();
const dialogOpeners = new Map<HTMLDialogElement, HTMLElement | null>();

const toolDescriptions: Record<ToolId, string> = {
  blush: "A soft wash of color anywhere on the paintable face.",
  shadow: "Color anywhere on the paintable face. Take it softly or build it up.",
  lipstick: "A defined lip, from a soft tint to full gloss.",
  liner: "Free painting anywhere on the visible face, with a precise brush.",
  sparkle: "A five-point stamp. One touch, a little light.",
  erase: "Remove makeup, never the skin beneath it.",
  blend: "Soften existing makeup edges. More passes build the effect. No added color.",
};

type GuideKey = "lipsCenter" | "lipsLeftCorner" | "lipsRightCorner" | "cheekLeft" | "cheekRight" | "upperLidLeft" | "upperLidRight";
type Guides = Readonly<Record<GuideKey, UV>>;
const guideKeys: readonly GuideKey[] = ["lipsCenter", "lipsLeftCorner", "lipsRightCorner", "cheekLeft", "cheekRight", "upperLidLeft", "upperLidRight"];
let guides: Guides | null = null;

function readSession(): Session {
  return session;
}

function currentLook(): Look {
  return session.phase === "editing" ? session.history.current : session.submission.look;
}

function announce(message: string, persistent = false): void {
  window.clearTimeout(toastTimer);
  query("#app-status").textContent = message;
  if (session.phase === "editing" && session.workspace === "customize") {
    query("#customization-notice").textContent = message;
    query("#customization-notice").hidden = false;
    query("#toast").hidden = true;
    return;
  }
  query("#toast").hidden = false;
  if (!persistent) toastTimer = window.setTimeout(() => { query("#toast").hidden = true; }, 6500);
}

function showDialog(id: string): void {
  const dialog = query<HTMLDialogElement>(id);
  dialogOpeners.set(dialog, document.activeElement instanceof HTMLElement ? document.activeElement : null);
  if (!dialog.open) dialog.showModal();
}

function closeDialog(id: string): void {
  query<HTMLDialogElement>(id).close();
}

for (const dialog of document.querySelectorAll<HTMLDialogElement>("dialog")) {
  dialog.addEventListener("close", () => {
    const opener = dialogOpeners.get(dialog);
    if (opener?.isConnected && !opener.closest("[hidden]")) opener.focus();
  });
  for (const button of dialog.querySelectorAll<HTMLButtonElement>("[data-close]")) {
    button.addEventListener("click", () => dialog.close());
  }
  dialog.addEventListener("click", (event) => {
    if (event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
  });
}

function applyPresentation(): void {
  if (portrait === null) return;
  const presentation = presentSession(session);
  portrait.present(before ? { ...presentation, look: clearMakeup(presentation.look), readonly: true } : presentation);
}

function dispatch(action: Action): void {
  const previous = currentLook();
  const previousPhase = readSession().phase;
  const previousWorkspace = presentSession(session).workspace;
  const next = step(session, action);
  const workspace = presentSession(next).workspace;
  if (workspace === "customize" && previousWorkspace !== "customize") makeupScroll = { x: scrollX, y: scrollY };
  session = next;
  if (currentLook() !== previous || action.type === "start" || action.type === "finish") revision++;
  before = false;
  applyPresentation();
  render();
  if (workspace !== previousWorkspace) {
    if (workspace === "customize") {
      query("#toast").hidden = true;
      query("#customization-notice").hidden = true;
      query("#customization-heading").focus({ preventScroll: true });
    } else {
      if (makeupScroll !== null) window.scrollTo(makeupScroll.x, makeupScroll.y);
      makeupScroll = null;
      if (session.phase === "editing") query("#customize-button").focus({ preventScroll: true });
    }
  }
  if (session.phase !== "editing") window.clearInterval(timer);
  if (next.phase === "reveal" && previousPhase !== "reveal") {
    const id = next.submission.id;
    query("#reveal-note").hidden = false;
    const delay = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 650;
    revealTimer = window.setTimeout(() => {
      dispatch({ type: "revealComplete", id });
      const completed = readSession();
      if (completed.phase !== "result" || completed.submission.id !== id) return;
      query("#result-heading").focus({ preventScroll: true });
      if (window.matchMedia("(max-width: 760px)").matches) query("#portrait-stage").scrollIntoView({ block: "start", behavior: "instant" });
      announce(completed.submission.outcome.kind === "practice" ? "Practice complete. Your look has no score." : "Your solo brief match is ready.");
    }, delay);
  }
}

function startRound(look: Look, increaseRound = true): void {
  window.clearInterval(timer);
  window.clearTimeout(revealTimer);
  if (increaseRound) round++;
  const mode: Mode = selectedKind === "practice" ? { kind: "practice" } : {
    kind: "challenge", theme: selectedTheme,
    deadline: selectedDuration === 0 ? null : Date.now() + selectedDuration * 60_000,
  };
  dispatch({ type: "start", look, mode });
  dispatch({ type: "brush", brush: { ...defaultBrush(), mirror: true } });
  scheduleClock();
}

function scheduleClock(): void {
  window.clearInterval(timer);
  renderClock();
  if (session.phase !== "editing" || session.mode.kind !== "challenge" || session.mode.deadline === null) return;
  timer = window.setInterval(() => {
    if (session.phase !== "editing" || session.mode.kind !== "challenge" || session.mode.deadline === null) return;
    renderClock();
    if (Date.now() >= session.mode.deadline) {
      if (portraitState !== "ready") return;
      announce("Time is up. Your completed gestures are now locked.");
      finishLook();
    }
  }, 250);
}

function renderClock(): void {
  const mode = session.phase === "editing" ? session.mode : null;
  const timed = mode?.kind === "challenge" && mode.deadline !== null;
  query("#clock-label").textContent = mode?.kind === "practice" ? "PRACTICE / NO SCORE" : timed ? "TIME TO MAKE YOUR MARK" : "AT YOUR OWN PACE";
  if (timed) {
    const seconds = Math.max(0, Math.ceil((mode.deadline! - Date.now()) / 1000));
    query("#clock").textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")} remaining`;
    query("#clock").classList.toggle("clock-urgent", seconds <= 30);
    query("#customization-clock").textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")} remaining`;
    query("#customization-clock").classList.toggle("clock-urgent", seconds <= 30);
  } else {
    query("#clock").textContent = mode?.kind === "practice" ? "No timer. No brief score." : "No timer · solo brief match";
    query("#clock").classList.remove("clock-urgent");
    query("#customization-clock").textContent = mode?.kind === "practice" ? "Practice · no timer" : "No timer";
    query("#customization-clock").classList.remove("clock-urgent");
  }
}

function render(): void {
  const editing = session.phase === "editing" ? session : null;
  const ready = portraitState === "ready";
  const brush = editing?.brush ?? defaultBrush();
  const presentation = presentSession(session);
  const customizing = presentation.workspace === "customize";
  query("#studio").dataset.workspace = presentation.workspace;
  document.documentElement.dataset.workspace = presentation.workspace;
  query("#studio").classList.toggle("is-result", !editing);
  for (const selector of ["#customization-header", "#customization-controls", "#customization-footer", "#inspection-hint"]) query(selector).hidden = !customizing;
  for (const selector of [".site-header", ".site-footer", ".skip-link", ".tool-rail", ".cosmetics-panel", ".brief-bar", ".stage-top-controls", ".framing-controls", "#before-button", ".view-divider", ".canvas-caption"]) query(selector).hidden = customizing;
  query<HTMLButtonElement>("#customize-button").disabled = !editing;
  query("#portrait-stage").dataset.phase = session.phase;
  query("#portrait-stage").dataset.framing = presentation.framing;
  query("#mode-label").textContent = selectedKind === "practice" ? "THE BRIEF / PRACTICE, NO SCORE" : "THE BRIEF / SOLO CHALLENGE";
  query("#theme-title").textContent = themes[selectedTheme].title;
  query("#theme-brief").textContent = themes[selectedTheme].brief;
  const [first, ...rest] = themes[selectedTheme].title.split(" ");
  const coverTitle = query("#cover-title");
  coverTitle.replaceChildren(document.createTextNode(first ?? ""), document.createElement("br"));
  const coverEmphasis = document.createElement("em");
  coverEmphasis.textContent = `${rest.join(" ")}.`;
  coverTitle.append(coverEmphasis);
  query("#cover-number").textContent = `N° ${String(round).padStart(2, "0")}`;
  query("#gesture-count").textContent = `${currentLook().strokes.length} ${currentLook().strokes.length === 1 ? "gesture" : "gestures"}`;
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-tool]")) {
    button.setAttribute("aria-pressed", String(brush.tool === button.dataset.tool));
    button.disabled = !editing;
  }
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-navigation]")) {
    button.setAttribute("aria-pressed", String(editing !== null && editing.navigation === button.dataset.navigation));
    button.disabled = !editing || !ready || before;
  }
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-frame]")) {
    button.setAttribute("aria-pressed", String((editing?.framing ?? "face") === button.dataset.frame));
    button.disabled = !editing || !ready || before;
  }
  const mirror = query<HTMLButtonElement>("#mirror-button");
  mirror.setAttribute("aria-pressed", String(brush.mirror));
  mirror.querySelector("span")!.textContent = brush.mirror ? "Mirror on" : "Mirror off";
  mirror.disabled = !editing;
  for (const selector of ["#undo-button", "#customization-undo"]) query<HTMLButtonElement>(selector).disabled = editing === null || editing.history.past.length === 0;
  for (const selector of ["#redo-button", "#customization-redo"]) query<HTMLButtonElement>(selector).disabled = editing === null || editing.history.future.length === 0;
  query<HTMLButtonElement>("#clear-button").disabled = !editing || currentLook().strokes.length === 0;
  query<HTMLButtonElement>("#before-button").disabled = !ready;
  query("#before-button").setAttribute("aria-pressed", String(before));
  query("#before-badge").hidden = !before;
  for (const id of ["#zoom-in", "#zoom-out"]) query<HTMLButtonElement>(id).disabled = !ready;
  query("#finish-bar").hidden = !editing || customizing;
  query<HTMLButtonElement>("#finish-button").disabled = !ready || !editing;
  query("#reveal-note").hidden = session.phase !== "reveal";
  query("#editor-panel").hidden = !editing;
  query("#result-panel").hidden = session.phase !== "result";
  query("#active-tool").textContent = tools[brush.tool].label;
  query("#tool-description").textContent = toolDescriptions[brush.tool];
  const region = toolRegion(brush.tool);
  const regionHint = region === "valid" ? "Anywhere on the paintable face" : `${regions[region].label} only`;
  query("#quick-active-tool").textContent = tools[brush.tool].label;
  query("#allowed-region").textContent = regionHint;
  const actionHint = brush.tool === "blend" ? "Move over existing makeup to soften its edges. More passes increase the effect."
    : brush.tool === "erase" ? "Drag over makeup to remove it." : "Choose a color and paint.";
  query("#canvas-help").textContent = customizing ? "Drag to turn your portrait. Use zoom to inspect. Your makeup is not editable here." : before ? "Before view. Select Before / after to keep painting." : !editing ? "Your finished look. Save it, share it, or make it a new beginning." : editing.navigation === "turn" ? "Turn mode. Drag to rotate. Choose Paint to make a mark." : `${tools[brush.tool].label}. ${regionHint}. ${actionHint}`;
  const pigment = tools[brush.tool].operation === "pigment";
  const opacityLabel = brush.tool === "blend" ? "Strength" : "Opacity";
  query("#brush-opacity-label").textContent = opacityLabel;
  query("#brush-opacity").setAttribute("aria-label", opacityLabel);
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-color]")) {
    button.setAttribute("aria-pressed", String(brush.color.toLowerCase() === button.dataset.color));
    button.disabled = !pigment;
  }
  query<HTMLInputElement>("#custom-color").value = brush.color;
  query<HTMLInputElement>("#custom-color").disabled = !pigment;
  query("#color-name").textContent = Object.values(palette).find((entry) => entry.color === brush.color)?.label ?? brush.color.toUpperCase();
  const ranges = [
    ["size", brush.radius, `${(brush.radius * 100).toFixed(1)}%`],
    ["opacity", brush.opacity, `${Math.round(brush.opacity * 100)}%`],
    ["softness", brush.softness, `${Math.round(brush.softness * 100)}%`],
    ["finish", brush.finish, `${Math.round(brush.finish * 100)}%`],
  ] as const;
  for (const [id, value, label] of ranges) {
    for (const input of document.querySelectorAll<HTMLInputElement>(`input[data-brush="${id}"]`)) {
      input.value = String(value);
      input.disabled = (id === "softness" && tools[brush.tool].tip === "star") || (id === "finish" && !pigment);
      const low = Number(input.min);
      const high = Number(input.max);
      input.style.setProperty("--range-fill", `${((value - low) / (high - low)) * 100}%`);
    }
    for (const output of document.querySelectorAll<HTMLOutputElement>(`output[data-brush-value="${id}"]`)) output.textContent = label;
  }
  const guided = editing && guides !== null && ["blush", "shadow", "lipstick"].includes(brush.tool);
  query("#guided-section").hidden = !guided;
  query<HTMLButtonElement>("#guided-button").disabled = !ready || !editing || before || (editing !== null && editing.navigation !== "paint");
  query("#guided-description").textContent = brush.tool === "lipstick" ? "A real stroke along the lip landmarks." : `A real stroke on ${brush.mirror ? "both" : "one"} ${brush.tool === "shadow" ? "upper lid" : "cheek"}${brush.mirror ? "s" : ""}, using the portrait's guides.`;
  renderAppearance();
  renderJobs();
  renderClock();
  if (session.phase === "result") renderResult();
  if (editing !== null && editing.notice !== null && editing.notice !== lastNotice) announce(editing.notice, true);
  lastNotice = editing?.notice ?? null;
}

function renderJobs(): void {
  for (const [key, selector, idle, busy] of [
    ["save", "#save-button", "Save look", "Saving…"],
    ["share", "#share-button", "Share", "Preparing…"],
    ["download", "#download-button", "Download PNG", "Rendering…"],
  ]) {
    const button = query<HTMLButtonElement>(selector!);
    button.disabled = portraitState !== "ready" || jobs.has(key!);
    button.setAttribute("aria-busy", String(jobs.has(key!)));
    button.querySelector("span")!.textContent = jobs.has(key!) ? busy! : idle!;
  }
}

function criterionText(rule: Criterion): string {
  if (rule.kind === "coverage") return `${rule.label}. ${Math.round(rule.range[0] * 100)}% to ${Math.round(rule.range[1] * 100)}% of ${regions[rule.region].label.toLowerCase()} covered.`;
  if (rule.kind === "finish") return `${rule.label}. ${Math.round(rule.range[0] * 100)}% to ${Math.round(rule.range[1] * 100)}% alpha-weighted gloss.`;
  return `${rule.label}. At least ${Math.round(rule.minimum * 100)}% of pigment near ${rule.colors.map((id) => palette[id].label.toLowerCase()).join(", ")}.`;
}

function renderBriefRules(theme: ThemeId): void {
  const list = query("#brief-rules");
  list.replaceChildren();
  for (const rule of themes[theme].rules) {
    const item = document.createElement("li");
    item.textContent = `${criterionText(rule)} ${rule.points} points.`;
    list.append(item);
  }
}

function renderResult(): void {
  if (session.phase !== "result") return;
  const outcome = session.submission.outcome;
  const heading = query("#result-heading");
  heading.innerHTML = outcome.kind === "practice" ? 'Made for<br><em>you.</em>' : 'That\'s your<br><em>cover.</em>';
  const summary = query("#result-summary");
  const evidence = query("#result-evidence");
  summary.replaceChildren();
  evidence.replaceChildren();
  if (outcome.kind === "practice") {
    const text = document.createElement("p");
    text.className = "practice-result";
    text.textContent = "No clock. No score. Just a look you made. Save it to your lookbook, or keep experimenting.";
    summary.append(text);
    return;
  }
  const critique = outcome.critique;
  const label = document.createElement("p");
  label.className = "eyebrow result-label";
  label.textContent = critique.label;
  const score = document.createElement("p");
  score.className = "result-score";
  score.dataset.testid = "brief-score";
  score.append(document.createTextNode(String(critique.total)));
  const denominator = document.createElement("span");
  denominator.textContent = ` / ${critique.outOf}`;
  score.append(denominator);
  const note = document.createElement("p");
  note.className = "result-note";
  note.textContent = "A match to the brief, not a beauty score. Only your final makeup is measured.";
  summary.append(label, score, note);
  for (const rule of critique.evidence) {
    const item = document.createElement("details");
    item.className = "result-rule";
    const title = document.createElement("summary");
    const text = document.createElement("span");
    text.textContent = rule.label;
    const points = document.createElement("strong");
    points.textContent = `${rule.earned} / ${rule.possible}`;
    title.append(text, points);
    const reason = document.createElement("p");
    reason.textContent = `${rule.reason} Target ${rule.target}.`;
    item.append(title, reason);
    evidence.append(item);
  }
}

const appearanceDefinitions = avatarFields.map((field) => ({ field, label: avatarLabels[field], entries: avatarCatalog[field] }));

function buildAppearance(): void {
  const container = query("#appearance-fields");
  for (const definition of appearanceDefinitions) {
    const fieldset = document.createElement("fieldset");
    fieldset.className = "appearance-field";
    const legend = document.createElement("legend");
    legend.textContent = definition.label;
    const choices = document.createElement("div");
    choices.className = "appearance-choices";
    for (const [id, entry] of Object.entries(definition.entries)) {
      const label = document.createElement("label");
      label.className = "appearance-choice";
      const radio = document.createElement("input");
      radio.type = "radio";
      radio.name = `appearance-${definition.field}`;
      radio.id = `appearance-${definition.field}-${id}`;
      radio.value = id;
      radio.addEventListener("change", () => { if (radio.checked) changeAppearance(definition.field, radio.value); });
      const name = document.createElement("span");
      name.textContent = entry.label;
      label.append(radio, name);
      choices.append(label);
    }
    fieldset.append(legend, choices);
    container.append(fieldset);
  }
}

function renderAppearance(): void {
  const identity = currentLook().identity;
  for (const definition of appearanceDefinitions) {
    for (const radio of document.querySelectorAll<HTMLInputElement>(`input[name="appearance-${definition.field}"]`)) radio.checked = radio.value === identity[definition.field];
  }
  query("#appearance-status").textContent = portraitState === "ready" ? "Portrait ready. Changes apply as you choose."
    : portraitState === "loading" ? "Updating your portrait. You can keep choosing."
    : "Portrait unavailable. Use Try again in the preview.";
}

function changeAppearance(field: AvatarChoice, value: string): void {
  if (session.phase !== "editing" || session.workspace !== "customize") return;
  const parsed = identityFromInput({ ...session.history.current.identity, [field]: value });
  if (parsed.ok) dispatch({ type: "identity", identity: parsed.value });
  else announce(parsed.error, true);
}

function updateBrush(patch: Partial<Brush>): void {
  if (session.phase !== "editing") return;
  const parsed = brushFromInput({ ...session.brush, ...patch });
  if (parsed.ok) dispatch({ type: "brush", brush: parsed.value });
  else announce(parsed.error, true);
}

function chooseTool(tool: ToolId): void {
  if (session.phase !== "editing") return;
  const mirror = session.brush.mirror;
  dispatch({ type: "brush", brush: { ...defaultBrush(tool), mirror } });
}

for (const button of document.querySelectorAll<HTMLButtonElement>("[data-tool]")) {
  button.addEventListener("click", () => { if (isKey(tools, button.dataset.tool)) chooseTool(button.dataset.tool); });
}
for (const button of document.querySelectorAll<HTMLButtonElement>("[data-color]")) {
  button.addEventListener("click", () => {
    const input = brushFromInput({ ...(session.phase === "editing" ? session.brush : defaultBrush()), color: button.dataset.color });
    if (input.ok) updateBrush({ color: input.value.color });
  });
}
for (const button of document.querySelectorAll<HTMLButtonElement>("[data-navigation]")) {
  button.addEventListener("click", () => {
    const navigation = button.dataset.navigation;
    if (navigation === "paint" || navigation === "turn") dispatch({ type: "navigate", navigation: navigation as Navigation });
  });
}
for (const button of document.querySelectorAll<HTMLButtonElement>("[data-frame]")) {
  button.addEventListener("click", () => {
    const framing = button.dataset.frame;
    if (framing === "face" || framing === "eyes" || framing === "lips") dispatch({ type: "frame", framing: framing as Framing });
  });
}
for (const [id, field] of [["size", "radius"], ["opacity", "opacity"], ["softness", "softness"], ["finish", "finish"]] as const) {
  for (const input of document.querySelectorAll<HTMLInputElement>(`input[data-brush="${id}"]`)) {
    input.addEventListener("input", () => updateBrush({ [field]: Number(input.value) }));
  }
}
query<HTMLInputElement>("#custom-color").addEventListener("input", (event) => {
  const input = event.currentTarget as HTMLInputElement;
  const parsed = brushFromInput({ ...(session.phase === "editing" ? session.brush : defaultBrush()), color: input.value });
  if (parsed.ok) updateBrush({ color: parsed.value.color });
});
query("#mirror-button").addEventListener("click", () => { if (session.phase === "editing") updateBrush({ mirror: !session.brush.mirror }); });
for (const selector of ["#undo-button", "#customization-undo"]) query(selector).addEventListener("click", () => dispatch({ type: "undo" }));
for (const selector of ["#redo-button", "#customization-redo"]) query(selector).addEventListener("click", () => dispatch({ type: "redo" }));
query("#customize-button").addEventListener("click", () => dispatch({ type: "workspace", workspace: "customize" }));
query("#customization-done").addEventListener("click", () => dispatch({ type: "workspace", workspace: "makeup" }));
query("#clear-button").addEventListener("click", () => showDialog("#clear-dialog"));
query("#confirm-clear").addEventListener("click", () => {
  dispatch({ type: "clearConfirmed" });
  closeDialog("#clear-dialog");
  announce("Makeup cleared. Your skin and portrait styling are unchanged. Undo can bring the makeup back.");
});
query("#zoom-in").addEventListener("click", () => portrait?.zoom("in"));
query("#zoom-out").addEventListener("click", () => portrait?.zoom("out"));
query("#before-button").addEventListener("click", () => {
  before = !before;
  applyPresentation();
  render();
  announce(before ? "Before view. The portrait is not editable until you return to after." : "After view. Your makeup is restored.");
});
query("#help-button").addEventListener("click", () => showDialog("#help-dialog"));
query("#credits-button").addEventListener("click", () => showDialog("#credits-dialog"));
query("#stage-credits").addEventListener("click", () => showDialog("#credits-dialog"));
query("#retry-button").addEventListener("click", () => {
  if (portrait === null) window.location.reload();
  else portrait.retryAppearance();
});
query("#dismiss-toast").addEventListener("click", () => { query("#toast").hidden = true; });

query("#brief-button").addEventListener("click", () => {
  query<HTMLInputElement>(`input[name="theme"][value="${selectedTheme}"]`).checked = true;
  query<HTMLSelectElement>("#round-mode").value = selectedKind;
  query<HTMLSelectElement>("#round-duration").value = String(selectedDuration);
  updateModeChoice();
  renderBriefRules(selectedTheme);
  showDialog("#brief-dialog");
});
function updateModeChoice(): void {
  const practice = query<HTMLSelectElement>("#round-mode").value === "practice";
  query<HTMLSelectElement>("#round-duration").disabled = practice;
  query("#timer-note").textContent = practice ? "Practice has no timer and no brief score. Your selected brief is inspiration only." : "A timed round starts when you apply this brief. Finishing locks the look.";
}
query("#round-mode").addEventListener("change", updateModeChoice);
for (const input of document.querySelectorAll<HTMLInputElement>('input[name="theme"]')) {
  input.addEventListener("change", () => { if (isKey(themes, input.value)) renderBriefRules(input.value); });
}
query<HTMLFormElement>("#brief-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const theme = query<HTMLInputElement>('input[name="theme"]:checked').value;
  if (!isKey(themes, theme)) return;
  selectedTheme = theme;
  selectedKind = query<HTMLSelectElement>("#round-mode").value === "practice" ? "practice" : "challenge";
  const minutes = Number(query<HTMLSelectElement>("#round-duration").value);
  selectedDuration = minutes === 3 || minutes === 5 ? minutes : 0;
  startRound(currentLook(), false);
  closeDialog("#brief-dialog");
  announce(`${themes[selectedTheme].title} ${selectedKind === "practice" ? "practice" : "brief"} selected. Your makeup is unchanged.`);
});

function finishLook(): void {
  if (portrait === null || session.phase !== "editing" || portraitState !== "ready") return;
  before = false;
  applyPresentation();
  try {
    const analysis = portrait.analyze();
    for (const dialog of document.querySelectorAll<HTMLDialogElement>("dialog[open]")) dialog.close();
    dispatch({ type: "finish", id: crypto.randomUUID(), analysis });
  } catch {
    announce("The portrait could not be measured. Your look is still editable. Try Finish look again.", true);
  }
}
query("#finish-button").addEventListener("click", finishLook);
query("#next-button").addEventListener("click", () => {
  selectedTheme = themeIds[(themeIds.indexOf(selectedTheme) + 1) % themeIds.length] ?? "orchid-hour";
  startRound(clearMakeup(currentLook()));
  canvas.focus({ preventScroll: true });
  query("#studio").scrollIntoView({ block: "start", behavior: "instant" });
});
query("#remix-button").addEventListener("click", () => {
  startRound(currentLook());
  canvas.focus({ preventScroll: true });
  query("#studio").scrollIntoView({ block: "start", behavior: "instant" });
  announce("The look is yours to edit again.");
});
query("#replay-button").addEventListener("click", () => {
  startRound(clearMakeup(currentLook()));
  canvas.focus({ preventScroll: true });
  query("#studio").scrollIntoView({ block: "start", behavior: "instant" });
});

async function loadGuides(): Promise<void> {
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}face/v2/asset.json`);
    if (!response.ok) return;
    const metadata: unknown = await response.json();
    if (typeof metadata !== "object" || metadata === null || !("id" in metadata) || metadata.id !== "rain-portrait-v2" || !("paintAtlas" in metadata)) return;
    const atlas = metadata.paintAtlas;
    if (typeof atlas !== "object" || atlas === null || !("landmarks" in atlas)) return;
    const landmarks = atlas.landmarks;
    if (typeof landmarks !== "object" || landmarks === null) return;
    const parsed = {} as Record<GuideKey, UV>;
    for (const key of guideKeys) {
      if (!(key in landmarks)) return;
      const landmark: unknown = Reflect.get(landmarks, key);
      if (typeof landmark !== "object" || landmark === null || !("paintUV" in landmark)) return;
      const uv: unknown = landmark.paintUV;
      if (!Array.isArray(uv) || uv.length !== 2 || !uv.every((value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1)) return;
      parsed[key] = [uv[0] as number, uv[1] as number];
    }
    guides = Object.freeze(parsed);
    render();
  } catch {
    query("#guided-section").hidden = true;
  }
}

query("#guided-button").addEventListener("click", () => {
  if (session.phase !== "editing" || guides === null || session.navigation !== "paint") return;
  const brush = session.brush;
  let paths: UV[][];
  if (brush.tool === "lipstick") {
    paths = [[guides.lipsRightCorner, guides.lipsCenter, guides.lipsLeftCorner]];
  } else if (brush.tool === "blush" || brush.tool === "shadow") {
    const pair = brush.tool === "blush" ? [guides.cheekLeft, guides.cheekRight] : [guides.upperLidLeft, guides.upperLidRight];
    const span = brush.tool === "blush" ? 0.016 : 0.025;
    paths = pair.slice(0, brush.mirror ? 2 : 1).map((uv) => [[uv[0] - span, uv[1]], uv, [uv[0] + span, uv[1]]]);
  } else return;
  const captured = captureStroke(crypto.randomUUID(), brush, paths);
  if (!captured.ok) { announce(captured.error, true); return; }
  if (portrait?.applyStroke(captured.value)) {
    announce(`Guided ${tools[brush.tool].label.toLowerCase()} applied as one undoable gesture.`);
  }
});

function beginJob(name: string): number | null {
  if (jobs.has(name) || (name !== "copy" && portraitState !== "ready")) return null;
  const token = ++jobCounter;
  jobs.set(name, token);
  renderJobs();
  return token;
}
function endJob(name: string, token: number): void {
  if (jobs.get(name) === token) jobs.delete(name);
  renderJobs();
}
function isCurrentJob(name: string, token: number, atRevision: number): boolean {
  return jobs.get(name) === token && revision === atRevision;
}
function captureLook(look: Look): Promise<Blob> {
  const activePortrait = portrait;
  if (activePortrait === null) return Promise.reject(new Error("The portrait is not ready."));
  const result = captureTail.then(() => activePortrait.capture(look));
  captureTail = result.then(() => undefined, () => undefined);
  return result;
}

async function makeThumbnail(blob: Blob): Promise<string> {
  if (blob.type !== "image/png") throw new Error("The portrait did not return a PNG.");
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const thumbnail = document.createElement("canvas");
    thumbnail.width = 220;
    thumbnail.height = Math.min(300, Math.round((image.naturalHeight / image.naturalWidth) * 220));
    const context = thumbnail.getContext("2d");
    if (context === null) throw new Error("Thumbnail creation is unavailable.");
    context.drawImage(image, 0, 0, thumbnail.width, thumbnail.height);
    const data = thumbnail.toDataURL("image/png");
    if (data.length > lookbookLimits.thumbnailCharacters) throw new Error("This preview is too large to save.");
    return data;
  } finally {
    URL.revokeObjectURL(url);
  }
}

query("#save-button").addEventListener("click", () => { void saveCurrentLook(); });
async function saveCurrentLook(): Promise<void> {
  const token = beginJob("save");
  if (token === null) return;
  const atRevision = revision;
  const look = currentLook();
  const title = `${themes[selectedTheme].title} ${String(round).padStart(2, "0")}`;
  try {
    const existing = readLookbook(storage);
    if (!existing.ok) { announce(existing.error, true); return; }
    const saved = existing.value.find((entry) => entry.id === lookFingerprint(look));
    if (saved !== undefined) {
      if (encodeLook(saved.look) === encodeLook(look)) announce("This exact look is already in your lookbook.");
      else announce("The local content ID conflicts. Your current look is safe. Download a PNG instead.", true);
      return;
    }
    const blob = await captureLook(look);
    const thumbnail = await makeThumbnail(blob);
    if (!isCurrentJob("save", token, atRevision)) {
      announce("The look changed before saving finished. Nothing was replaced. Save again to keep the latest look.");
      return;
    }
    const result = saveLook(storage, { look, title, thumbnail, savedAt: Date.now() });
    if (!result.ok) { announce(result.error, true); return; }
    refreshSavedCount();
    if (query<HTMLDialogElement>("#lookbook-dialog").open) renderLookbook();
    announce(result.value.alreadySaved ? "This exact look is already in your lookbook." : "Saved to your lookbook on this device.");
  } catch {
    announce("The preview could not be saved. Your current look is safe. Try again, or download a PNG.", true);
  } finally {
    endJob("save", token);
  }
}

async function makeExportCover(blob: Blob, title: string): Promise<Blob> {
  if (blob.type !== "image/png") throw new Error("The portrait did not return a PNG.");
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = url;
    await Promise.all([
      image.decode(),
      Promise.allSettled([
        document.fonts.load('600 100px "Bodoni Moda"'),
        document.fonts.load('500 italic 39px "Bodoni Moda"'),
        document.fonts.load('500 14px "DM Sans"'),
        document.fonts.load('400 14px "DM Sans"'),
      ]),
    ]);
    const cover = document.createElement("canvas");
    cover.width = 1080;
    cover.height = 1350;
    const context = cover.getContext("2d");
    if (context === null) throw new Error("The browser could not create the cover.");
    context.drawImage(image, 0, 0, cover.width, cover.height);
    context.fillStyle = "#faf7f1";
    context.fillRect(0, 0, 1080, 141);
    context.fillRect(0, 1280, 1080, 70);
    context.fillStyle = "#2a2130";
    context.font = '500 14px "DM Sans", sans-serif';
    context.fillText("THE VIRTUAL MAKEUP ATELIER", 46, 28);
    context.font = '600 100px "Bodoni Moda", Georgia, serif';
    context.fillText("MAKE1UP", 42, 115);
    context.textAlign = "right";
    context.font = '500 italic 39px "Bodoni Moda", Georgia, serif';
    context.fillText(title, 1034, 105);
    context.fillStyle = "#af247f";
    context.beginPath();
    context.moveTo(570, 64);
    context.bezierCurveTo(572, 80, 577, 86, 594, 88);
    context.bezierCurveTo(577, 90, 572, 96, 570, 112);
    context.bezierCurveTo(568, 96, 563, 90, 546, 88);
    context.bezierCurveTo(563, 86, 568, 80, 570, 64);
    context.fill();
    context.textAlign = "left";
    context.fillStyle = "#2a2130";
    context.font = '400 14px "DM Sans", sans-serif';
    context.fillText("Rain Rig (CC) Blender Foundation | studio.blender.org", 46, 1307);
    context.fillStyle = "#716673";
    context.font = '400 12px "DM Sans", sans-serif';
    context.fillText("Modified for MAKE1UP. CC BY 4.0. creativecommons.org/licenses/by/4.0/", 46, 1329);
    return await new Promise<Blob>((resolve, reject) => cover.toBlob((result) => {
      if (result === null) reject(new Error("The browser could not encode the cover PNG."));
      else resolve(result);
    }, "image/png"));
  } finally {
    URL.revokeObjectURL(url);
  }
}

query("#download-button").addEventListener("click", () => { void downloadCurrentLook(); });
async function downloadCurrentLook(): Promise<void> {
  const token = beginJob("download");
  if (token === null) return;
  const atRevision = revision;
  const look = currentLook();
  const name = `MAKE1UP-${selectedTheme}-${String(round).padStart(2, "0")}.png`;
  const title = themes[selectedTheme].title;
  let url: string | null = null;
  try {
    const blob = await makeExportCover(await captureLook(look), title);
    if (!isCurrentJob("download", token, atRevision)) {
      announce("The look changed during export. Download again to capture the latest version.");
      return;
    }
    if (blob.type !== "image/png" || blob.size === 0) throw new Error("A PNG was not returned.");
    url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    document.body.append(link);
    link.click();
    link.remove();
    announce("Your PNG is ready. Check your browser's downloads.");
  } catch {
    announce("The PNG could not be created. Your look is unchanged. Try again.", true);
  } finally {
    if (url !== null) window.setTimeout(() => URL.revokeObjectURL(url!), 30_000);
    endJob("download", token);
  }
}

query("#share-button").addEventListener("click", () => { void shareCurrentLook(); });
async function shareCurrentLook(): Promise<void> {
  const token = beginJob("share");
  if (token === null) return;
  const atRevision = revision;
  const look = currentLook();
  try {
    const encoded = await encodeShare(look);
    if (!isCurrentJob("share", token, atRevision)) {
      announce("The look changed while the link was prepared. Select Share again for the latest version.");
      return;
    }
    if (!encoded.ok) { announce(encoded.error, true); return; }
    const url = new URL(window.location.href);
    url.hash = encoded.value;
    query<HTMLTextAreaElement>("#share-url").value = url.href;
    query("#copy-link").firstChild!.textContent = "Copy link ";
    showDialog("#share-dialog");
    announce("Your private remix link is ready. Nothing was uploaded.");
  } catch {
    announce("The share link could not be created. Your look is unchanged. Download a PNG instead.", true);
  } finally {
    endJob("share", token);
  }
}
query("#copy-link").addEventListener("click", () => { void copyShareLink(); });
async function copyShareLink(): Promise<void> {
  const input = query<HTMLTextAreaElement>("#share-url");
  const value = input.value;
  const token = beginJob("copy");
  if (token === null) return;
  const button = query<HTMLButtonElement>("#copy-link");
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  try {
    if (navigator.clipboard?.writeText === undefined) throw new Error("Clipboard unavailable");
    await navigator.clipboard.writeText(value);
    if (input.value === value) {
      announce("Remix link copied.");
      button.firstChild!.textContent = "Link copied ";
    } else announce("The previous link was copied. Copy again to use the new link.");
  } catch {
    input.focus();
    input.select();
    announce("This browser blocks clipboard access. The link is selected. Copy it with your keyboard or touch menu.", true);
  } finally {
    button.disabled = false;
    button.setAttribute("aria-busy", "false");
    endJob("copy", token);
  }
}

function refreshSavedCount(): void {
  const result = readLookbook(storage);
  query("#saved-count").textContent = result.ok ? String(result.value.length) : "!";
}
window.addEventListener("storage", (event) => {
  if (event.key !== lookbookKey && event.key !== null) return;
  refreshSavedCount();
  if (query<HTMLDialogElement>("#lookbook-dialog").open) renderLookbook();
});
query("#lookbook-button").addEventListener("click", () => {
  renderLookbook();
  showDialog("#lookbook-dialog");
});
function renderLookbook(): void {
  const container = query("#lookbook-content");
  container.replaceChildren();
  const result = readLookbook(storage);
  if (!result.ok || result.value.length === 0) {
    const empty = document.createElement("div");
    empty.className = "lookbook-empty";
    const title = document.createElement("h3");
    title.textContent = result.ok ? "Your first cover belongs here." : "Your saved looks could not be opened.";
    const description = document.createElement("p");
    description.textContent = result.ok ? "Paint a look and select Save look. Your makeup and a portrait preview stay together." : result.error;
    empty.append(title, description);
    container.append(empty);
    return;
  }
  const grid = document.createElement("div");
  grid.className = "lookbook-grid";
  for (const [position, entry] of result.value.entries()) grid.append(savedLookCard(entry, position));
  container.append(grid);
}
function savedLookCard(entry: SavedLook, position: number): HTMLElement {
  const accessibleTitle = `${entry.title}, saved look ${position + 1}`;
  const card = document.createElement("article");
  card.className = "saved-look";
  const image = document.createElement("img");
  image.src = entry.thumbnail;
  image.alt = `${entry.title} saved portrait preview`;
  image.width = 220;
  image.height = 280;
  const title = document.createElement("h3");
  title.textContent = entry.title;
  const date = document.createElement("p");
  date.textContent = new Date(entry.savedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  const open = document.createElement("button");
  open.className = "outline-button";
  open.textContent = "Open look";
  open.setAttribute("aria-label", `Open ${accessibleTitle}`);
  open.addEventListener("click", () => {
    const latest = readLookbook(storage);
    if (!latest.ok) { announce(latest.error, true); return; }
    const saved = latest.value.find((item) => item.id === entry.id);
    if (saved === undefined) { renderLookbook(); announce("That saved look is no longer in this browser."); return; }
    loadRequest++;
    if (session.phase === "editing") dispatch({ type: "load", look: saved.look });
    else startRound(saved.look);
    closeDialog("#lookbook-dialog");
    canvas.focus({ preventScroll: true });
    announce(`Opened ${saved.title}. Your actual makeup is ready to edit.`);
  });
  const remove = document.createElement("button");
  remove.className = "text-button remove-look";
  remove.textContent = "Remove";
  remove.setAttribute("aria-label", `Remove ${accessibleTitle} from lookbook`);
  remove.addEventListener("click", () => {
    removeId = entry.id;
    query("#remove-description").textContent = `${entry.title} will leave this device's lookbook. Your current portrait will not change.`;
    showDialog("#remove-dialog");
  });
  card.append(image, title, date, open, remove);
  return card;
}
query("#confirm-remove").addEventListener("click", () => {
  if (removeId === null) return;
  const result = removeSavedLook(storage, removeId);
  removeId = null;
  closeDialog("#remove-dialog");
  if (!result.ok) { announce(result.error, true); return; }
  renderLookbook();
  refreshSavedCount();
  announce("Saved look removed. Your current portrait is unchanged.");
});

async function loadSharedLook(): Promise<void> {
  const fragment = window.location.hash;
  if (!fragment.startsWith("#make1up=")) return;
  const token = ++loadRequest;
  const atRevision = revision;
  const decoded = await decodeShare(fragment);
  if (token !== loadRequest) return;
  if (revision !== atRevision) { announce("You started editing while the share link opened. Your newer look was kept."); return; }
  if (!decoded.ok) { announce(decoded.error, true); return; }
  for (const dialog of document.querySelectorAll<HTMLDialogElement>("dialog[open]")) dialog.close();
  if (session.phase === "editing") dispatch({ type: "load", look: decoded.value });
  else startRound(decoded.value);
  announce("Shared look opened. These are the original UV strokes, ready for your remix.");
}
window.addEventListener("hashchange", () => { void loadSharedLook(); });
window.addEventListener("keydown", (event) => {
  if (document.querySelector("dialog[open]") !== null || session.phase !== "editing") return;
  if (event.key === "Escape" && session.workspace === "customize") {
    event.preventDefault();
    dispatch({ type: "workspace", workspace: "makeup" });
    return;
  }
  const target = event.target;
  if (target instanceof HTMLElement && (target.matches("input, select, textarea") || target.isContentEditable)) return;
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
    event.preventDefault();
    dispatch({ type: event.shiftKey ? "redo" : "undo" });
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") {
    event.preventDefault();
    dispatch({ type: "redo" });
    return;
  }
  if (session.workspace === "makeup" && !event.ctrlKey && !event.metaKey && !event.altKey && /^[1-7]$/.test(event.key)) {
    const tool = toolIds[Number(event.key) - 1];
    if (tool !== undefined) { event.preventDefault(); chooseTool(tool); }
  }
});
window.addEventListener("pagehide", (event) => {
  if (event.persisted) return;
  window.clearInterval(timer);
  window.clearTimeout(revealTimer);
  window.clearTimeout(toastTimer);
  portrait?.dispose();
});

function appearanceAvailability(state: AppearanceAvailability): void {
  if (portrait === null) return;
  portraitState = state.kind;
  query("#portrait-stage").dataset.state = state.kind;
  query("#stage-message").hidden = state.kind === "ready";
  query("#retry-button").hidden = state.kind !== "error";
  if (state.kind === "loading") {
    query("#stage-message-title").textContent = "Updating your portrait.";
    query("#stage-message-copy").textContent = "Your selected colors are loading. Painting resumes when they are ready.";
  } else if (state.kind === "error") {
    query("#stage-message-title").textContent = "Those colors could not load.";
    query("#stage-message-copy").textContent = state.message;
  }
  render();
}

buildAppearance();
refreshSavedCount();
renderBriefRules(selectedTheme);
render();
void loadGuides();
void loadSharedLook();
void import("./portrait").then(({ mountPortrait }) => mountPortrait(
  canvas,
  (stroke) => dispatch({ type: "stroke", stroke }),
  (message) => { dispatch({ type: "inputRejected", message }); announce(message, true); },
  appearanceAvailability,
)).then((mounted) => {
  portrait = mounted;
  portraitState = "ready";
  query("#portrait-stage").dataset.state = "ready";
  query("#stage-message").hidden = true;
  applyPresentation();
  render();
  scheduleClock();
}).catch((error: unknown) => {
  portraitState = "error";
  query("#portrait-stage").dataset.state = "error";
  query("#stage-message-title").textContent = "The portrait could not open.";
  query("#stage-message-copy").textContent = error instanceof Error && /webgl/i.test(error.message)
    ? "This browser could not start WebGL. Try a current browser with hardware acceleration enabled."
    : "A portrait file may be unavailable. Check your connection, then try again. Your look has not changed.";
  query("#retry-button").hidden = false;
  query("#stage-message").hidden = false;
  render();
  announce("The 3D portrait is unavailable. Painting and finishing are disabled until it loads.", true);
});
