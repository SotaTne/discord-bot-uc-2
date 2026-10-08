import { ApplicationCommandOptionType, type Interaction } from "./types";

function findOption(interaction: Interaction, name: string) {
  return interaction.data?.options?.find((option) => option.name === name);
}

/** 整数オプションの値。指定がない・整数でないときは null */
export function getIntegerOption(interaction: Interaction, name: string): number | null {
  const option = findOption(interaction, name);
  if (option?.type !== ApplicationCommandOptionType.Integer) return null;
  return typeof option.value === "number" && Number.isInteger(option.value) ? option.value : null;
}

/** 文字列オプション（ロールの ID を含む）の値。指定がなければ null */
export function getStringOption(interaction: Interaction, name: string): string | null {
  const value = findOption(interaction, name)?.value;
  return typeof value === "string" ? value : null;
}
