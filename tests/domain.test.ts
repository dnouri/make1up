import { describe, expect, it } from "vitest";
import {
  appendStroke, brushFromInput, captureStroke, decodeLook, decodeLookJSON,
  defaultBrush, encodeLook, identityFromInput, lookFingerprint, newLook, palette, regions,
  themes, toolRegion, tools,
} from "../src/look";
import type { Brush, Look, Result, Stroke, UV } from "../src/look";
import { createSession, presentSession, step } from "../src/session";
import type { EditingSession, Session } from "../src/session";
import type { PaintAnalysis } from "../src/paint";

function value<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

function editing(session: Session): EditingSession {
  if (session.phase !== "editing") throw new Error("Expected an editing session.");
  return session;
}

function stroke(id: string, changes: Partial<Brush> = {}): Stroke {
  return value(captureStroke(id, { ...defaultBrush("liner"), ...changes }, [[[0.2, 0.4], [0.4, 0.4]]]));
}

const analysis: PaintAnalysis = {
  alphaMass: 20,
  coverage: { valid: 0.05, lips: 0.5, cheeks: 0.5, lids: 0.5 },
  paletteMass: { rose: 1, orchid: 0, plum: 0, ink: 0, gold: 0, pearl: 0, coral: 0, other: 0 },
  glossShare: 0.4,
};

describe("look boundary", () => {
  it("captures independent mirror paths and copies the brush for one gesture", () => {
    const brush = { ...defaultBrush("blush"), color: "#CC5075", mirror: true };
    const paths = [[[0.2, 0.4], [0.4, 0.4]], [[0.8, 0.4], [0.6, 0.4]]];
    const captured = value(captureStroke("gesture-a", brush, paths));
    brush.color = "#000000";
    paths[0]?.push([0, 0]);
    expect(captured).toEqual({
      id: "gesture-a",
      brush: { tool: "blush", color: "#cc5075", radius: 0.045, opacity: 0.55, softness: 0.85, finish: 0 },
      paths: [[[0.2, 0.4], [0.4, 0.4]], [[0.8, 0.4], [0.6, 0.4]]],
    });
    expect(Object.isFrozen(captured.paths[0][0])).toBe(true);
  });

  it("round trips a canonical saved document and supplies a stable content key", () => {
    const look = newLook();
    expect(encodeLook(value(decodeLookJSON(encodeLook(look))))).toBe(
      '{"version":2,"asset":"rain-portrait-v2","identity":{"face":"balanced","nose":"balanced","mouth":"balanced","eyeShape":"balanced","complexion":"warm","eyes":"blue","hairColor":"espresso","hairStyle":"ponytail"},"strokes":[]}',
    );
    expect(lookFingerprint(value(decodeLookJSON(encodeLook(look))))).toBe(lookFingerprint(look));
    const painted = value(appendStroke(look, stroke("one")));
    expect(value(decodeLookJSON(encodeLook(painted))).strokes[0]?.id).toBe("one");
    expect(lookFingerprint(painted) === lookFingerprint(look)).toBe(false);
  });

  it("rejects corrupt JSON, unknown versions, assets, catalogs, and duplicate IDs", () => {
    expect(decodeLookJSON("{")).toEqual({ ok: false, error: "The saved look is not valid JSON." });
    expect(decodeLook({ ...newLook(), version: 4 })).toEqual({ ok: false, error: "This look has an unknown version or portrait asset." });
    expect(decodeLook({ ...newLook(), asset: "invented-face" })).toEqual({ ok: false, error: "This look has an unknown version or portrait asset." });
    expect(identityFromInput({ ...newLook().identity, geometry: "sculpted-heart" })).toEqual({ ok: false, error: "Unknown portrait appearance option." });
    expect(decodeLook({ ...newLook(), strokes: [stroke("same"), stroke("same")] })).toEqual({ ok: false, error: "A saved look repeats a gesture ID." });
  });

  it.each([NaN, Infinity, -Infinity, -0.1, 1.1])("rejects a nonfinite or out-of-range UV %s", (u) => {
    expect(captureStroke("bad", defaultBrush(), [[[u, 0.5]]])).toEqual({
      ok: false, error: "Paint coordinates must be finite UV pairs between zero and one.",
    });
    expect(captureStroke("good", defaultBrush(), [[[0.2, 0.4]]])).toMatchObject({ ok: true, value: { id: "good" } });
  });

  it.each([
    { radius: 0 }, { radius: 0.2 }, { opacity: NaN }, { opacity: 1.1 },
    { softness: Infinity }, { softness: -1 }, { finish: -0.1 }, { color: "#f0f" },
  ])("rejects invalid settings %j", (changes) => {
    expect(brushFromInput({ ...defaultBrush(), ...changes })).toEqual({
      ok: false, error: "Brush color or settings are outside their allowed range.",
    });
    expect(brushFromInput(defaultBrush("lipstick"))).toMatchObject({ ok: true, value: { tool: "lipstick", finish: 0.8 } });
  });

  it("rejects unknown tools, fake booleans, empty paths, and invalid IDs", () => {
    expect(brushFromInput({ ...defaultBrush(), tool: "foundation-morph" })).toEqual({ ok: false, error: "Unknown makeup tool." });
    expect(brushFromInput({ ...defaultBrush(), mirror: "true" })).toEqual({ ok: false, error: "Mirror must be a boolean." });
    expect(captureStroke("empty", defaultBrush(), [[]])).toEqual({ ok: false, error: "A stroke path cannot be empty." });
    expect(captureStroke("bad id", defaultBrush(), [[[0.2, 0.4]]])).toEqual({ ok: false, error: "A stroke ID must have one to 64 letters, digits, underscores, or hyphens." });
  });

  it("caps JSON bytes, gesture count, and point count before replay", () => {
    expect(decodeLookJSON(" ".repeat(1_000_001))).toEqual({ ok: false, error: "The saved look exceeds the one megabyte limit." });
    expect(decodeLookJSON(`"${"é".repeat(500_000)}"`)).toEqual({ ok: false, error: "The saved look exceeds the one megabyte limit." });
    expect(decodeLook({ ...newLook(), strokes: Array.from({ length: 161 }, (_, i) => stroke(`s${i}`)) })).toEqual({
      ok: false, error: "The saved look has too many gestures or no gesture list.",
    });
    expect(captureStroke("huge", defaultBrush(), [Array.from({ length: 513 }, () => [0.2, 0.4])])).toEqual({
      ok: false, error: "This gesture has too many points.",
    });
    const path: UV[] = Array.from({ length: 512 }, () => [0.2, 0.4]);
    const strokes = Array.from({ length: 17 }, (_, i) => value(captureStroke(`s${i}`, defaultBrush(), [path])));
    expect(decodeLook({ ...newLook(), strokes })).toEqual({ ok: false, error: "The saved look has too many paint points." });
    expect(captureStroke("paths", defaultBrush(), Array.from({ length: 9 }, () => [[0.2, 0.4]]))).toEqual({
      ok: false, error: "A gesture needs one to eight separate paths.",
    });
    let full: Look = newLook();
    for (const item of strokes.slice(0, 16)) full = value(appendStroke(full, item));
    expect(full.strokes.length).toBe(16);
    expect(appendStroke(full, stroke("extra"))).toEqual({ ok: false, error: "This look has reached its paint point limit." });
  });

  it("rejects invalid saved samples and settings through the JSON gate", () => {
    const badUV = { ...newLook(), strokes: [{ ...stroke("bad"), paths: [[[1.1, 0.4]]] }] };
    expect(decodeLookJSON(JSON.stringify(badUV))).toEqual({
      ok: false, error: "Paint coordinates must be finite UV pairs between zero and one.",
    });
    const nonfinite = { ...newLook(), strokes: [{ ...stroke("bad"), brush: { ...stroke("bad").brush, opacity: NaN } }] };
    expect(decodeLookJSON(JSON.stringify(nonfinite))).toEqual({
      ok: false, error: "Brush color or settings are outside their allowed range.",
    });
    const valid = value(decodeLookJSON(encodeLook(value(appendStroke(newLook(), stroke("valid"))))));
    expect(valid.strokes.map((item) => item.id)).toEqual(["valid"]);
  });

  it("applies the same limits to live append and rejects a repeated gesture", () => {
    let look: Look = newLook();
    for (let i = 0; i < 160; i += 1) look = value(appendStroke(look, stroke(`s${i}`)));
    expect(look.strokes.length).toBe(160);
    expect(appendStroke(look, stroke("extra"))).toEqual({
      ok: false, error: "This look has reached its gesture limit. Clear some makeup or start a new look.",
    });
    expect(appendStroke(look, stroke("s0"))).toEqual({ ok: false, error: "That gesture was already applied." });
  });

  it("keeps registry references valid for every tool, theme, and real portrait option", () => {
    for (const id of Object.keys(tools)) {
      const parsed = brushFromInput({ ...defaultBrush(), tool: id });
      expect(parsed.ok).toBe(true);
      if (parsed.ok) {
        const brush = defaultBrush(parsed.value.tool);
        expect(brushFromInput(brush)).toEqual({ ok: true, value: brush });
        expect(Object.hasOwn(regions, toolRegion(brush.tool))).toBe(true);
      }
    }
    for (const theme of Object.values(themes)) {
      expect(theme.rules.reduce((sum, rule) => sum + rule.points, 0)).toBe(100);
      for (const rule of theme.rules) {
        if (rule.kind === "palette") {
          for (const color of rule.colors) expect(Object.hasOwn(palette, color)).toBe(true);
        }
        if (rule.kind === "coverage") expect(Object.hasOwn(regions, rule.region)).toBe(true);
      }
    }
  });
});

describe("session transactions", () => {
  it("makes one multi-path gesture one undo item and preserves old brush settings", () => {
    const gesture = value(captureStroke("both", defaultBrush("blush"), [[[0.2, 0.4]], [[0.8, 0.4]]]));
    let session: Session = step(createSession(), { type: "stroke", stroke: gesture });
    session = step(session, { type: "brush", brush: defaultBrush("liner") });
    expect(editing(session).history.past.length).toBe(1);
    expect(editing(session).history.current.strokes[0]?.brush.tool).toBe("blush");
    session = step(session, { type: "undo" });
    expect(editing(session).history.current.strokes.length).toBe(0);
    session = step(session, { type: "redo" });
    expect(editing(session).history.current.strokes.map((item) => [item.id, item.paths.length])).toEqual([["both", 2]]);
  });

  it("captures the selected lipstick default without changing saved lip settings", () => {
    const savedJSON = encodeLook(value(appendStroke(newLook(), stroke("saved-lip", {
      ...defaultBrush("lipstick"), color: "#51284e", radius: 0.025,
    }))));
    const saved = value(decodeLookJSON(savedJSON));
    let session: Session = step(createSession(saved), { type: "brush", brush: defaultBrush("lipstick") });
    const captured = value(captureStroke("new-lip", editing(session).brush, [[[0.4, 0.8], [0.6, 0.8]]]));
    session = step(session, { type: "stroke", stroke: captured });
    session = step(session, { type: "brush", brush: defaultBrush("liner") });
    const painted = encodeLook(editing(session).history.current);
    expect(value(decodeLookJSON(painted)).strokes.map((item) => item.brush)).toEqual([
      { tool: "lipstick", color: "#51284e", radius: 0.025, opacity: 0.95, softness: 0.3, finish: 0.8 },
      { tool: "lipstick", color: "#cc5075", radius: 0.055, opacity: 0.95, softness: 0.3, finish: 0.8 },
    ]);
    session = step(session, { type: "undo" });
    expect(encodeLook(editing(session).history.current)).toBe(savedJSON);
    session = step(session, { type: "redo" });
    expect(encodeLook(editing(session).history.current)).toBe(painted);
    expect(encodeLook(saved)).toBe(savedJSON);
  });

  it("drops the redo branch after an edit and lets clear be undone", () => {
    let session: Session = step(createSession(), { type: "stroke", stroke: stroke("a") });
    session = step(session, { type: "stroke", stroke: stroke("b") });
    session = step(session, { type: "undo" });
    session = step(session, { type: "stroke", stroke: stroke("c") });
    session = step(session, { type: "redo" });
    expect(editing(session).history.current.strokes.map((item) => item.id)).toEqual(["a", "c"]);
    session = step(session, { type: "clearConfirmed" });
    expect(editing(session).history.current.strokes.length).toBe(0);
    session = step(session, { type: "undo" });
    expect(editing(session).history.current.strokes.map((item) => item.id)).toEqual(["a", "c"]);
  });

  it("bounds undo to 50 items without truncating the current document", () => {
    let session: Session = createSession();
    for (let i = 0; i < 55; i += 1) session = step(session, { type: "stroke", stroke: stroke(`s${i}`) });
    expect(editing(session).history.past.length).toBe(50);
    expect(editing(session).history.current.strokes.length).toBe(55);
    for (let i = 0; i < 51; i += 1) session = step(session, { type: "undo" });
    expect(editing(session).history.current.strokes.map((item) => item.id)).toEqual(["s0", "s1", "s2", "s3", "s4"]);
    expect(editing(session).history.future.length).toBe(50);
  });

  it("freezes one submission, ignores duplicate finish, and rejects stale reveal completion", () => {
    let session: Session = createSession(newLook(), { kind: "challenge", theme: "rose-editorial", deadline: null });
    session = step(session, { type: "stroke", stroke: stroke("final") });
    session = step(session, { type: "finish", id: "round-one", analysis });
    const frozen = session;
    session = step(session, { type: "finish", id: "duplicate", analysis });
    session = step(session, { type: "stroke", stroke: stroke("late") });
    session = step(session, { type: "revealComplete", id: "old-round" });
    expect(session).toBe(frozen);
    if (session.phase !== "reveal") throw new Error("Expected reveal.");
    expect(session.submission.id).toBe("round-one");
    expect(session.submission.look.strokes.map((item) => item.id)).toEqual(["final"]);
    expect(session.submission.outcome).toMatchObject({ kind: "challenge", critique: { total: 100 } });
    expect(Object.isFrozen(session.submission)).toBe(true);
    session = step(session, { type: "revealComplete", id: "round-one" });
    expect(session.phase).toBe("result");
    expect(presentSession(session).readonly).toBe(true);
    session = step(session, { type: "start", look: newLook(), mode: { kind: "practice" } });
    session = step(session, { type: "revealComplete", id: "round-one" });
    expect(session.phase).toBe("editing");
  });

  it("keeps practice untimed, blocks paint while turning, and projects only renderer inputs", () => {
    let session: Session = createSession();
    expect(editing(session).mode).toEqual({ kind: "practice" });
    session = step(session, { type: "navigate", navigation: "turn" });
    session = step(session, { type: "stroke", stroke: stroke("blocked") });
    expect(editing(session).history.current.strokes.length).toBe(0);
    session = step(session, { type: "navigate", navigation: "paint" });
    session = step(session, { type: "frame", framing: "lips" });
    session = step(session, { type: "stroke", stroke: stroke("accepted") });
    const frame = presentSession(session);
    expect([frame.readonly, frame.framing, frame.navigation, frame.look.strokes[0]?.id]).toEqual([false, "lips", "paint", "accepted"]);
    expect(Object.keys(frame).sort()).toEqual(["brush", "framing", "look", "navigation", "readonly"]);
    session = step(session, { type: "finish", id: "practice", analysis });
    if (session.phase !== "reveal") throw new Error("Expected reveal.");
    expect(session.submission.outcome).toEqual({ kind: "practice" });
  });
});
