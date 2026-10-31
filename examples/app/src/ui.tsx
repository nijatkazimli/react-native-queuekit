import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
  type ViewStyle,
} from "react-native";
import { colors, mono } from "./theme";

export function Screen({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ padding: 16, paddingBottom: 48, gap: 14 }}
      keyboardShouldPersistTaps="handled"
    >
      {children}
    </ScrollView>
  );
}

export function Card({
  title,
  hint,
  children,
  right,
}: Readonly<{ title?: string; hint?: string; children?: ReactNode; right?: ReactNode }>) {
  return (
    <View style={s.card}>
      {title ? (
        <View style={s.cardHead}>
          <View style={{ flex: 1 }}>
            <Text style={s.cardTitle}>{title}</Text>
            {hint ? <Text style={s.hint}>{hint}</Text> : null}
          </View>
          {right}
        </View>
      ) : null}
      {children}
    </View>
  );
}

export function Heading({ children }: Readonly<{ children: ReactNode }>) {
  return <Text style={s.heading}>{children}</Text>;
}

export function Body({ children, muted }: Readonly<{ children: ReactNode; muted?: boolean }>) {
  return <Text style={[s.body, muted && { color: colors.muted }]}>{children}</Text>;
}

export function Code({ children }: Readonly<{ children: ReactNode }>) {
  return <Text style={s.code}>{children}</Text>;
}

type BtnProps = Readonly<{
  label: string;
  onPress: () => void;
  kind?: "primary" | "ghost" | "danger" | "ok";
  small?: boolean;
  disabled?: boolean;
  style?: ViewStyle;
}>;

export function Btn({ label, onPress, kind = "primary", small, disabled, style }: BtnProps) {
  const bg = { primary: colors.accent, ghost: "transparent", danger: colors.bad, ok: colors.ok }[
    kind
  ];
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        s.btn,
        small && s.btnSmall,
        { backgroundColor: bg, opacity: disabled ? 0.4 : pressed ? 0.75 : 1 },
        kind === "ghost" && { borderWidth: 1, borderColor: colors.border },
        style,
      ]}
    >
      <Text
        style={[s.btnText, small && { fontSize: 12 }, kind === "ghost" && { color: colors.text }]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function Row({ children, wrap }: Readonly<{ children: ReactNode; wrap?: boolean }>) {
  return <View style={[s.row, wrap && { flexWrap: "wrap" }]}>{children}</View>;
}

export function Chip({
  label,
  active,
  onPress,
}: Readonly<{ label: string; active?: boolean; onPress: () => void }>) {
  return (
    <Pressable
      onPress={onPress}
      style={[s.chip, active && { backgroundColor: colors.accent, borderColor: colors.accent }]}
    >
      <Text style={[s.chipText, active && { color: "#fff" }]}>{label}</Text>
    </Pressable>
  );
}

export function Badge({ label, color }: Readonly<{ label: string; color: string }>) {
  return (
    <View style={[s.badge, { borderColor: color }]}>
      <Text style={[s.badgeText, { color }]}>{label}</Text>
    </View>
  );
}

export function Stat({
  label,
  value,
  color,
}: Readonly<{ label: string; value: string | number; color?: string }>) {
  return (
    <View style={s.stat}>
      <Text style={[s.statValue, color ? { color } : null]}>{value}</Text>
      <Text style={s.statLabel}>{label}</Text>
    </View>
  );
}

export function Progress({
  value,
  color = colors.active,
}: Readonly<{ value: number; color?: string }>) {
  return (
    <View style={s.track}>
      <View style={[s.fill, { width: `${Math.round(value * 100)}%`, backgroundColor: color }]} />
    </View>
  );
}

export function Toggle({
  label,
  hint,
  value,
  onChange,
}: Readonly<{ label: string; hint?: string; value: boolean; onChange: (v: boolean) => void }>) {
  return (
    <View style={s.toggle}>
      <View style={{ flex: 1 }}>
        <Text style={s.body}>{label}</Text>
        {hint ? <Text style={s.hint}>{hint}</Text> : null}
      </View>
      <Switch value={value} onValueChange={onChange} trackColor={{ true: colors.accent }} />
    </View>
  );
}

// Keeps what the user is typing as text, and reports a number once it parses.
export function NumberField({
  label,
  value,
  onChange,
  hint,
  suffix,
}: Readonly<{
  label: string;
  value: number;
  onChange: (value: number) => void;
  hint?: string;
  suffix?: string;
}>) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  return (
    <View style={{ gap: 4 }}>
      <Text style={s.fieldLabel}>{label}</Text>
      <View style={s.inputWrap}>
        <TextInput
          value={text}
          onChangeText={(next) => {
            setText(next);
            const parsed = Number(next);
            if (next.trim() !== "" && Number.isFinite(parsed)) onChange(parsed);
          }}
          keyboardType="numeric"
          style={s.input}
          placeholderTextColor={colors.muted}
        />
        {suffix ? <Text style={s.hint}>{suffix}</Text> : null}
      </View>
      {hint ? <Text style={s.hint}>{hint}</Text> : null}
    </View>
  );
}

export function TextField({
  label,
  value,
  onChange,
  placeholder,
}: Readonly<{
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}>) {
  return (
    <View style={{ gap: 4 }}>
      <Text style={s.fieldLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
        autoCapitalize="none"
        autoCorrect={false}
        style={s.input}
      />
    </View>
  );
}

// Re-renders every `ms` so countdowns stay current.
export function useNow(ms = 500): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

const s = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    gap: 10,
  },
  cardHead: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  cardTitle: { color: colors.text, fontSize: 16, fontWeight: "700" },
  heading: { color: colors.text, fontSize: 26, fontWeight: "800" },
  body: { color: colors.text, fontSize: 14, lineHeight: 20 },
  hint: { color: colors.muted, fontSize: 12, lineHeight: 17 },
  code: {
    ...mono,
    color: colors.text,
    fontSize: 11,
    backgroundColor: colors.bg,
    borderRadius: 8,
    padding: 8,
    overflow: "hidden",
  },
  btn: {
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  btnSmall: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8 },
  btnText: { color: "#0B1020", fontWeight: "700", fontSize: 14 },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  chip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 20,
    paddingVertical: 5,
    paddingHorizontal: 12,
  },
  chipText: { color: colors.muted, fontSize: 12, fontWeight: "600" },
  badge: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  badgeText: { fontSize: 10, fontWeight: "700", textTransform: "uppercase" },
  stat: {
    flex: 1,
    backgroundColor: colors.cardAlt,
    borderRadius: 12,
    padding: 10,
    alignItems: "center",
  },
  statValue: { color: colors.text, fontSize: 24, fontWeight: "800" },
  statLabel: { color: colors.muted, fontSize: 11, marginTop: 2 },
  track: { height: 6, backgroundColor: colors.bg, borderRadius: 3, overflow: "hidden" },
  fill: { height: 6, borderRadius: 3 },
  toggle: { flexDirection: "row", alignItems: "center", gap: 10 },
  fieldLabel: { color: colors.muted, fontSize: 12, fontWeight: "600" },
  inputWrap: { flexDirection: "row", alignItems: "center", gap: 8 },
  input: {
    flex: 1,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    color: colors.text,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
  },
});
