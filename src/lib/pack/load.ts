import raw from "@/data/berlin-student.pack.json";
import { PackSchema, type Pack } from "./schema";
import { validatePack } from "./validate";

/** Parse and validate once at startup; refuse to run on a broken pack. */
export function loadPack(input: unknown = raw): Pack {
  const pack = PackSchema.parse(input);
  const errors = validatePack(pack).filter((i) => i.level === "error");
  if (errors.length) {
    throw new Error("Invalid pack:\n" + errors.map((e) => `  ${e.where}: ${e.message}`).join("\n"));
  }
  return pack;
}

export const berlinPack: Pack = loadPack();
