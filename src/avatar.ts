import registry from "../art/avatar-v2.json";
import type { Result } from "./look";

export const catalog = {
  geometry: {
    "neutral-rain": { label: "Rain portrait", asset: "rain-portrait-v1" },
  },
  eyes: {
    blue: { label: "Blue", texture: "/face/v1/eyes-blue.png" },
    hazel: { label: "Hazel", texture: "/face/v1/eyes-hazel.png" },
    olive: { label: "Olive", texture: "/face/v1/eyes-olive.png" },
  },
  complexions: {
    source: { label: "Source warm", tint: "#ffffff", status: "asset-supported" },
    rose: { label: "Rose tint", tint: "#f4d3cc", status: "needs-browser-check" },
    golden: { label: "Golden tint", tint: "#dca86d", status: "needs-browser-check" },
    deep: { label: "Deep tint", tint: "#765045", status: "needs-browser-check" },
  },
  hairColors: {
    espresso: { label: "Espresso", tint: "#ffffff", status: "asset-supported" },
    chestnut: { label: "Chestnut tint", tint: "#b96842", status: "needs-browser-check" },
    plum: { label: "Plum tint", tint: "#9f608f", status: "needs-browser-check" },
  },
  hairStyles: {
    ponytail: {
      label: "Fitted ponytail", status: "asset-supported",
      visible: ["Hair", "HairSweep", "HairTail", "HairTie"],
    },
    tucked: {
      label: "Front curl tucked", status: "needs-browser-check",
      visible: ["Hair", "HairTail", "HairTie"],
    },
    short: {
      label: "Tail hidden", status: "needs-browser-check",
      visible: ["Hair", "HairSweep"],
    },
  },
} as const;

export type ClassicIdentity = Readonly<{
  kind: "classic";
  geometry: keyof typeof catalog.geometry;
  eyes: keyof typeof catalog.eyes;
  complexion: keyof typeof catalog.complexions;
  hairColor: keyof typeof catalog.hairColors;
  hairStyle: keyof typeof catalog.hairStyles;
}>;

export type AvatarChoice = keyof typeof registry.choices;
export type AvatarChoiceId<Field extends AvatarChoice> = keyof typeof registry.choices[Field];
export type FaceId = AvatarChoiceId<"face">;
export type NoseId = AvatarChoiceId<"nose">;
export type MouthId = AvatarChoiceId<"mouth">;
export type EyeShapeId = AvatarChoiceId<"eyeShape">;
export type ComplexionId = AvatarChoiceId<"complexion">;
export type EyeColorId = AvatarChoiceId<"eyes">;
export type HairColorId = AvatarChoiceId<"hairColor">;
export type HairStyleId = AvatarChoiceId<"hairStyle">;
export type AvatarIdentity = Readonly<{ kind: "custom" } & {
  [Field in AvatarChoice]: AvatarChoiceId<Field>;
}>;
export type PortraitIdentity = ClassicIdentity | AvatarIdentity;

type Descriptions<Choices> = Readonly<{ [Id in keyof Choices]: Readonly<{ label: string }> }>;

function descriptions<Choices extends Record<string, { label: string }>>(choices: Choices): Descriptions<Choices> {
  return Object.freeze(Object.fromEntries(Object.entries(choices)
    .map(([id, choice]) => [id, Object.freeze({ label: choice.label })]))) as Descriptions<Choices>;
}

export const avatarCatalog = Object.freeze({
  face: descriptions(registry.choices.face),
  nose: descriptions(registry.choices.nose),
  mouth: descriptions(registry.choices.mouth),
  eyeShape: descriptions(registry.choices.eyeShape),
  complexion: descriptions(registry.choices.complexion),
  eyes: descriptions(registry.choices.eyes),
  hairColor: descriptions(registry.choices.hairColor),
  hairStyle: descriptions(registry.choices.hairStyle),
});

export const defaultIdentity: ClassicIdentity = Object.freeze({
  kind: "classic", geometry: "neutral-rain", eyes: "blue", complexion: "source",
  hairColor: "espresso", hairStyle: "ponytail",
});

function record(raw: unknown): raw is Record<string, unknown> {
  return typeof raw === "object" && raw !== null && !Array.isArray(raw);
}

function keyOf<Choices extends object>(choices: Choices, id: unknown): id is keyof Choices {
  return typeof id === "string" && Object.hasOwn(choices, id);
}

export function identityFromInput(raw: unknown): Result<ClassicIdentity> {
  if (!record(raw) || (raw.kind !== undefined && raw.kind !== "classic")
    || !keyOf(catalog.geometry, raw.geometry)
    || !keyOf(catalog.eyes, raw.eyes)
    || !keyOf(catalog.complexions, raw.complexion)
    || !keyOf(catalog.hairColors, raw.hairColor)
    || !keyOf(catalog.hairStyles, raw.hairStyle)) {
    return { ok: false, error: "Unknown portrait appearance option." };
  }
  return { ok: true, value: Object.freeze({
    kind: "classic", geometry: raw.geometry, eyes: raw.eyes, complexion: raw.complexion,
    hairColor: raw.hairColor, hairStyle: raw.hairStyle,
  }) };
}

export function avatarFromInput(raw: unknown): Result<AvatarIdentity> {
  if (!record(raw) || raw.kind !== "custom"
    || Object.keys(raw).some((key) => key !== "kind" && !Object.hasOwn(avatarCatalog, key))
    || !keyOf(avatarCatalog.face, raw.face)
    || !keyOf(avatarCatalog.nose, raw.nose)
    || !keyOf(avatarCatalog.mouth, raw.mouth)
    || !keyOf(avatarCatalog.eyeShape, raw.eyeShape)
    || !keyOf(avatarCatalog.complexion, raw.complexion)
    || !keyOf(avatarCatalog.eyes, raw.eyes)
    || !keyOf(avatarCatalog.hairColor, raw.hairColor)
    || !keyOf(avatarCatalog.hairStyle, raw.hairStyle)) {
    return { ok: false, error: "Unknown portrait appearance option." };
  }
  return { ok: true, value: Object.freeze({
    kind: "custom", face: raw.face, nose: raw.nose, mouth: raw.mouth, eyeShape: raw.eyeShape,
    complexion: raw.complexion, eyes: raw.eyes, hairColor: raw.hairColor, hairStyle: raw.hairStyle,
  }) };
}

const parsedDefault = avatarFromInput({ kind: "custom", ...registry.defaults });
if (!parsedDefault.ok) throw new Error("The avatar registry has invalid default choices.");
export const defaultAvatarIdentity: AvatarIdentity = parsedDefault.value;

const classicComplexions = {
  source: "warm", rose: "fair", golden: "tan", deep: "deep",
} as const satisfies Record<ClassicIdentity["complexion"], ComplexionId>;

export function upgradeIdentity(identity: ClassicIdentity): AvatarIdentity {
  return Object.freeze({
    ...defaultAvatarIdentity,
    complexion: classicComplexions[identity.complexion], eyes: identity.eyes,
    hairColor: identity.hairColor, hairStyle: "ponytail",
  });
}
