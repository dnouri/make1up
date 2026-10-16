import { appendStroke, clearMakeup, defaultBrush, encodeLook, limits, newLook, withIdentity } from "./look";
import type { Brush, Identity, Look, Result, Stroke, ThemeId } from "./look";
import { assess } from "./paint";
import type { Critique, PaintAnalysis } from "./paint";

export type Mode =
  | Readonly<{ kind: "practice" }>
  | Readonly<{ kind: "challenge"; theme: ThemeId; deadline: number | null }>;
export type Framing = "face" | "eyes" | "lips";
export type Navigation = "paint" | "turn";
export type History = Readonly<{
  past: readonly Look[];
  current: Look;
  future: readonly Look[];
}>;
export type Submission = Readonly<{
  id: string;
  look: Look;
  outcome: Readonly<{ kind: "practice" }> | Readonly<{ kind: "challenge"; critique: Critique }>;
}>;
export type EditingSession = Readonly<{
  phase: "editing";
  mode: Mode;
  history: History;
  brush: Brush;
  navigation: Navigation;
  framing: Framing;
  notice: string | null;
}>;
export type Session = EditingSession
  | Readonly<{ phase: "reveal"; submission: Submission }>
  | Readonly<{ phase: "result"; submission: Submission }>;

export type Action =
  | Readonly<{ type: "start"; look: Look; mode: Mode }>
  | Readonly<{ type: "stroke"; stroke: Stroke }>
  | Readonly<{ type: "identity"; identity: Identity }>
  | Readonly<{ type: "load"; look: Look }>
  | Readonly<{ type: "brush"; brush: Brush }>
  | Readonly<{ type: "navigate"; navigation: Navigation }>
  | Readonly<{ type: "frame"; framing: Framing }>
  | Readonly<{ type: "undo" | "redo" | "clearConfirmed" | "dismissNotice" }>
  | Readonly<{ type: "inputRejected"; message: string }>
  | Readonly<{ type: "finish"; id: string; analysis: PaintAnalysis }>
  | Readonly<{ type: "revealComplete"; id: string }>;

export type PortraitPresentation = Readonly<{
  look: Look;
  brush: Brush;
  navigation: Navigation;
  framing: Framing;
  readonly: boolean;
}>;

export function createSession(
  look: Look = newLook(),
  mode: Mode = { kind: "practice" },
): EditingSession {
  return Object.freeze({
    phase: "editing", mode: Object.freeze({ ...mode }),
    history: Object.freeze({ past: Object.freeze([]), current: look, future: Object.freeze([]) }),
    brush: defaultBrush(), navigation: "paint", framing: "face", notice: null,
  });
}

function recordEdit(session: EditingSession, next: Look): EditingSession {
  if (encodeLook(session.history.current) === encodeLook(next)) return session;
  return Object.freeze({
    ...session,
    history: Object.freeze({
      past: Object.freeze([...session.history.past, session.history.current].slice(-limits.history)),
      current: next,
      future: Object.freeze([]),
    }),
    notice: null,
  });
}

function applyLookResult(session: EditingSession, result: Result<Look>): EditingSession {
  return result.ok ? recordEdit(session, result.value) : Object.freeze({ ...session, notice: result.error });
}

export function step(session: Session, action: Action): Session {
  if (action.type === "start") return createSession(action.look, action.mode);
  if (action.type === "revealComplete") {
    return session.phase === "reveal" && session.submission.id === action.id
      ? Object.freeze({ phase: "result", submission: session.submission })
      : session;
  }
  if (session.phase !== "editing") return session;
  switch (action.type) {
    case "stroke":
      return session.navigation === "paint"
        ? applyLookResult(session, appendStroke(session.history.current, action.stroke))
        : session;
    case "identity":
      return recordEdit(session, withIdentity(session.history.current, action.identity));
    case "load":
      return recordEdit(session, action.look);
    case "brush":
      return Object.freeze({ ...session, brush: action.brush, notice: null });
    case "navigate":
      return Object.freeze({ ...session, navigation: action.navigation });
    case "frame":
      return Object.freeze({ ...session, framing: action.framing });
    case "inputRejected":
      return Object.freeze({ ...session, notice: action.message });
    case "dismissNotice":
      return Object.freeze({ ...session, notice: null });
    case "clearConfirmed":
      return recordEdit(session, clearMakeup(session.history.current));
    case "undo": {
      const previous = session.history.past.at(-1);
      if (previous === undefined) return session;
      return Object.freeze({
        ...session, notice: null,
        history: Object.freeze({
          past: Object.freeze(session.history.past.slice(0, -1)),
          current: previous,
          future: Object.freeze([session.history.current, ...session.history.future].slice(0, limits.history)),
        }),
      });
    }
    case "redo": {
      const next = session.history.future[0];
      if (next === undefined) return session;
      return Object.freeze({
        ...session, notice: null,
        history: Object.freeze({
          past: Object.freeze([...session.history.past, session.history.current].slice(-limits.history)),
          current: next,
          future: Object.freeze(session.history.future.slice(1)),
        }),
      });
    }
    case "finish": {
      const outcome: Submission["outcome"] = session.mode.kind === "practice"
        ? Object.freeze({ kind: "practice" })
        : Object.freeze({ kind: "challenge", critique: assess(session.mode.theme, action.analysis) });
      return Object.freeze({
        phase: "reveal",
        submission: Object.freeze({ id: action.id, look: session.history.current, outcome }),
      });
    }
  }
}

export function presentSession(session: Session): PortraitPresentation {
  return session.phase === "editing"
    ? Object.freeze({
      look: session.history.current, brush: session.brush, navigation: session.navigation,
      framing: session.framing, readonly: false,
    })
    : Object.freeze({
      look: session.submission.look, brush: defaultBrush(), navigation: "turn", framing: "face", readonly: true,
    });
}
