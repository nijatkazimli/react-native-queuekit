export const colors = {
  bg: "#0B1020",
  card: "#141B34",
  cardAlt: "#1B2447",
  border: "#2A3562",
  text: "#E8ECFF",
  muted: "#8C97C4",
  accent: "#6C8CFF",
  ok: "#3DDC97",
  warn: "#FFB020",
  bad: "#FF5C7A",
  active: "#4FC3F7",
};

export const statusColor = {
  pending: colors.warn,
  active: colors.active,
  failed: colors.bad,
} as const;

export const mono = { fontFamily: "Menlo" } as const;
