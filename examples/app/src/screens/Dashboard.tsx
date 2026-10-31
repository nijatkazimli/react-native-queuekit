import { useQueueStats } from "@nijatk/react-native-queuekit/react";
import { useState } from "react";
import { Text, View } from "react-native";
import {
  backgroundStatus,
  backgroundSupported,
  registerBackground,
  triggerBackground,
  unregisterBackground,
} from "../background";
import { setForcedOffline, useForcedOffline, useOnline } from "../network";
import { rebuildRuntime, removeFollower, spawnFollower, useRuntime } from "../runtime";
import { colors } from "../theme";
import { attemptAsync, notify } from "../toast";
import { Badge, Body, Btn, Card, Code, Heading, Row, Screen, Stat, Toggle, useNow } from "../ui";

function Instances() {
  const runtime = useRuntime();
  useNow(1000);
  const rows = [
    { label: "A", queue: runtime.queue, main: true },
    ...runtime.followers.map((f) => ({ label: f.label, queue: f.queue, main: false })),
  ];
  return (
    <Card
      title="Instances and leader lease"
      hint="With the lease setting on, several queues sharing one storage elect a single leader that runs the jobs. Stop the leader and another takes over within seconds."
    >
      {!runtime.settings.lease ? (
        <Text style={{ color: colors.warn, fontSize: 12 }}>
          Lease is off (Settings): extra instances would all run the same jobs.
        </Text>
      ) : null}
      {rows.map(({ label, queue, main }) => {
        const stats = queue.getStats();
        return (
          <Row key={label} wrap>
            <Text style={{ color: colors.text, fontWeight: "800", width: 18 }}>{label}</Text>
            <Badge
              label={queue.isLeader() ? "leader" : "follower"}
              color={queue.isLeader() ? colors.ok : colors.muted}
            />
            <Text style={{ color: colors.muted, fontSize: 12, flex: 1 }}>
              {stats.pending}p {stats.active}a {stats.failed}f
            </Text>
            <Btn label="Stop" small kind="ghost" onPress={() => queue.stop()} />
            <Btn label="Start" small kind="ghost" onPress={() => queue.start()} />
            {main ? null : (
              <Btn label="Remove" small kind="danger" onPress={() => removeFollower(label)} />
            )}
          </Row>
        );
      })}
      <Btn label="Spawn another instance" small onPress={spawnFollower} />
    </Card>
  );
}

function Background() {
  const [info, setInfo] = useState("");
  if (!backgroundSupported) {
    return (
      <Card
        title="Background tasks"
        hint="Not available on web. Run the app on a device or simulator."
      />
    );
  }
  return (
    <Card
      title="Background tasks"
      hint="expo-background-task calls queue.drain() while the app is closed. The OS decides when (15 minutes at the earliest), so use Trigger now to test in development."
    >
      <Row wrap>
        <Btn
          label="Register"
          small
          onPress={async () => {
            await attemptAsync(registerBackground);
            setInfo("Register finished (see any error toast)");
          }}
        />
        <Btn
          label="Unregister"
          small
          kind="ghost"
          onPress={async () => {
            await attemptAsync(unregisterBackground);
            setInfo("Unregister finished");
          }}
        />
        <Btn
          label="Status"
          small
          kind="ghost"
          onPress={async () =>
            setInfo(`Status code: ${String(await attemptAsync(backgroundStatus))}`)
          }
        />
        <Btn
          label="Trigger now"
          small
          kind="ok"
          onPress={async () => {
            const ok = await attemptAsync(triggerBackground);
            setInfo(
              ok ? "Triggered: check the Events tab" : "Could not trigger (needs a dev build)",
            );
          }}
        />
      </Row>
      {info ? <Code>{info}</Code> : null}
    </Card>
  );
}

export function DashboardScreen() {
  const { queue, settings, generation } = useRuntime();
  const stats = useQueueStats();
  const online = useOnline();
  const forced = useForcedOffline();
  useNow(1000);

  return (
    <Screen>
      <Heading>QueueKit Lab</Heading>
      <Body muted>
        Test every feature of @nijatk/react-native-queuekit. Queue generation {generation}, storage:{" "}
        {settings.storage}.
      </Body>

      <Card>
        <Row>
          <Stat label="pending" value={stats.pending} color={colors.warn} />
          <Stat label="active" value={stats.active} color={colors.active} />
          <Stat label="failed" value={stats.failed} color={colors.bad} />
          <Stat label="total" value={stats.total} />
        </Row>
        <Row wrap>
          <Badge label={online ? "online" : "offline"} color={online ? colors.ok : colors.bad} />
          <Badge
            label={queue.isLeader() ? "leader" : "follower"}
            color={queue.isLeader() ? colors.ok : colors.muted}
          />
        </Row>
      </Card>

      <Card
        title="Controls"
        hint="start, stop, flush, drain, clear, and a restart that reloads everything from storage."
      >
        <Row wrap>
          <Btn label="Start" small onPress={() => queue.start()} />
          <Btn label="Stop" small kind="ghost" onPress={() => queue.stop()} />
          <Btn label="Flush" small kind="ghost" onPress={() => queue.flush()} />
          <Btn
            label="Drain (5 s)"
            small
            kind="ghost"
            onPress={async () => {
              const idle = await queue.drain({ timeoutMs: 5000 });
              notify(
                idle ? "drain(): queue is idle" : "drain(): timed out, work remains",
                idle ? "ok" : "info",
              );
            }}
          />
          <Btn label="Clear" small kind="danger" onPress={() => queue.clear()} />
        </Row>
        <Btn
          label="Restart queue (simulates an app restart)"
          small
          kind="ghost"
          onPress={() => rebuildRuntime()}
        />
      </Card>

      <Card title="Network">
        <Toggle
          label="Simulated offline"
          hint="Forces offline on top of the real connection. Jobs that need the network wait; others keep running."
          value={forced}
          onChange={setForcedOffline}
        />
      </Card>

      <Instances />
      <Background />
      <View style={{ height: 8 }} />
    </Screen>
  );
}
