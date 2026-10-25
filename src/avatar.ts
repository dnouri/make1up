import registry from "../art/avatar-v2.json" with { type: "json" };
import type { Result } from "./look";

export const avatarChoices = registry.choices;
export type AvatarChoice = keyof typeof avatarChoices;
export type AvatarChoiceId<Field extends AvatarChoice> = keyof typeof avatarChoices[Field];
export type AvatarIdentity = Readonly<{
  [Field in AvatarChoice]: AvatarChoiceId<Field>;
}>;
export const avatarFields = Object.freeze(Object.keys(avatarChoices) as AvatarChoice[]);
export const shapeFields = ["face", "nose", "mouth", "eyeShape"] as const;

export const avatarLabels = {
  face: "Face shape", nose: "Nose shape", mouth: "Mouth shape", eyeShape: "Eye shape",
  complexion: "Complexion", eyes: "Iris color", hairColor: "Hair color", hairStyle: "Hairstyle",
} as const satisfies Record<AvatarChoice, string>;

type Descriptions<Choices> = Readonly<{ [Id in keyof Choices]: Readonly<{ label: string }> }>;
function descriptions<Choices extends Record<string, { label: string }>>(choices: Choices): Descriptions<Choices> {
  return Object.freeze(Object.fromEntries(Object.entries(choices)
    .map(([id, choice]) => [id, Object.freeze({ label: choice.label })]))) as Descriptions<Choices>;
}

export const avatarCatalog = Object.freeze({
  face: descriptions(avatarChoices.face),
  nose: descriptions(avatarChoices.nose),
  mouth: descriptions(avatarChoices.mouth),
  eyeShape: descriptions(avatarChoices.eyeShape),
  complexion: descriptions(avatarChoices.complexion),
  eyes: descriptions(avatarChoices.eyes),
  hairColor: descriptions(avatarChoices.hairColor),
  hairStyle: descriptions(avatarChoices.hairStyle),
});

export function identityFromInput(raw: unknown): Result<AvatarIdentity> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)
    || Object.keys(raw).length !== avatarFields.length
    || !avatarFields.every((field) => Object.hasOwn(raw, field)
      && typeof Reflect.get(raw, field) === "string"
      && Object.hasOwn(avatarChoices[field], Reflect.get(raw, field)))) {
    return { ok: false, error: "Unknown portrait appearance option." };
  }
  return { ok: true, value: Object.freeze(Object.fromEntries(avatarFields
    .map((field) => [field, Reflect.get(raw, field)]))) as AvatarIdentity };
}

const parsedDefault = identityFromInput(registry.defaults);
if (!parsedDefault.ok) throw new Error("The avatar registry has invalid default choices.");
export const defaultIdentity: AvatarIdentity = parsedDefault.value;
