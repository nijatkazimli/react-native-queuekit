import { flushOnForeground } from "@nijatk/react-native-queuekit";
import { QueueProvider, useQueueStats } from "@nijatk/react-native-queuekit/react";
import { StatusBar } from "expo-status-bar";
import { type ReactElement, useEffect, useState } from "react";
import { AppState, Pressable, Text, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { useRuntime } from "./src/runtime";
import { DashboardScreen } from "./src/screens/Dashboard";
import { EventsScreen } from "./src/screens/Events";
import { LabScreen } from "./src/screens/Lab";
import { QueueScreen } from "./src/screens/Queue";
import { SettingsScreen } from "./src/screens/Settings";
import { colors } from "./src/theme";
import { useToast } from "./src/toast";

const TABS: {
  id: string;
  label: string;
  screen: (props: { go: (tab: string) => void }) => ReactElement;
}[] = [
  { id: "dashboard", label: "Dashboard", screen: DashboardScreen },
  { id: "lab", label: "Lab", screen: LabScreen },
  { id: "queue", label: "Queue", screen: QueueScreen },
  { id: "events", label: "Events", screen: EventsScreen },
  { id: "settings", label: "Settings", screen: SettingsScreen },
];

function Toast() {
  const toast = useToast();
  if (!toast) return null;
  const bg = { info: colors.cardAlt, ok: colors.ok, error: colors.bad }[toast.kind];
  return (
    <View
      pointerEvents="none"
      style={{ position: "absolute", top: 8, left: 12, right: 12, alignItems: "center" }}
    >
      <View
        style={{
          backgroundColor: bg,
          borderRadius: 12,
          paddingHorizontal: 14,
          paddingVertical: 10,
        }}
      >
        <Text style={{ color: toast.kind === "info" ? colors.text : "#0B1020", fontWeight: "700" }}>
          {toast.text}
        </Text>
      </View>
    </View>
  );
}

function TabBar({
  active,
  onSelect,
}: Readonly<{ active: string; onSelect: (id: string) => void }>) {
  const stats = useQueueStats();
  const open = stats.pending + stats.active;
  return (
    <View
      style={{
        flexDirection: "row",
        backgroundColor: colors.card,
        borderTopWidth: 1,
        borderTopColor: colors.border,
      }}
    >
      {TABS.map((tab) => (
        <Pressable
          key={tab.id}
          onPress={() => onSelect(tab.id)}
          style={{ flex: 1, alignItems: "center", paddingVertical: 12 }}
        >
          <Text
            style={{
              color: active === tab.id ? colors.accent : colors.muted,
              fontSize: 12,
              fontWeight: "700",
            }}
          >
            {tab.label}
            {tab.id === "queue" && open > 0 ? ` (${open})` : ""}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

function Shell() {
  const { queue } = useRuntime();
  const [active, setActive] = useState("dashboard");

  // Jobs that came due while the app was suspended run as soon as it returns.
  useEffect(() => flushOnForeground(queue, AppState), [queue]);

  return (
    <QueueProvider queue={queue}>
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
        <StatusBar style="light" />
        {/* Every tab stays mounted so typed input and scroll position survive switching. */}
        {TABS.map(({ id, screen: Tab }) => (
          <View key={id} style={{ flex: 1, display: active === id ? "flex" : "none" }}>
            <Tab go={setActive} />
          </View>
        ))}
        <TabBar active={active} onSelect={setActive} />
        <Toast />
      </SafeAreaView>
    </QueueProvider>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <Shell />
    </SafeAreaProvider>
  );
}
