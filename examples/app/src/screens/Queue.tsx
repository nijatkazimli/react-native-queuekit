import type { Job, JobStatus } from "@nijatk/react-native-queuekit";
import { useJob, useJobs } from "@nijatk/react-native-queuekit/react";
import { useState } from "react";
import { Modal, Text, View } from "react-native";
import { QUEUE_NAME, useRuntime } from "../runtime";
import { statusColor } from "../theme";
import { attempt, notify } from "../toast";
import { Badge, Body, Btn, Card, Chip, Code, Heading, Progress, Row, Screen, useNow } from "../ui";

const FILTERS: (JobStatus | "all")[] = ["all", "pending", "active", "failed"];

const secondsUntil = (time: number, now: number) =>
  `${Math.max(0, Math.ceil((time - now) / 1000))}s`;

function Details({ id, onClose }: Readonly<{ id: string; onClose: () => void }>) {
  const { storage } = useRuntime();
  const job = useJob(id);
  const stored = storage.getString(`queuekit:${QUEUE_NAME}:job:${id}`);
  return (
    <Modal animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: "#0B1020", padding: 16, paddingTop: 56, gap: 12 }}>
        <Heading>Job details</Heading>
        <Body muted>
          useJob(id) follows the job live and returns undefined once it completes or is removed.
        </Body>
        <Text style={{ color: "#8C97C4", fontWeight: "700" }}>useJob()</Text>
        <Code>{job ? JSON.stringify(job, null, 2) : "(gone)"}</Code>
        <Text style={{ color: "#8C97C4", fontWeight: "700" }}>Raw value in storage</Text>
        <Code>{stored ?? "(not stored)"}</Code>
        <Btn label="Close" onPress={onClose} />
      </View>
    </Modal>
  );
}

function JobCard({ job, onDetails }: Readonly<{ job: Job; onDetails: () => void }>) {
  const { queue } = useRuntime();
  const now = useNow(500);
  const tags: string[] = [];
  if (job.priority !== 0) tags.push(`priority ${job.priority}`);
  if (job.orderKey) tags.push(`order: ${job.orderKey}`);
  if (job.dedupeKey) tags.push(`dedupe: ${job.dedupeKey}`);
  if (!job.requiresNetwork) tags.push("works offline");
  if (job.sensitive) tags.push("sensitive");
  if (job.timeoutMs) tags.push(`timeout ${job.timeoutMs}ms`);
  if (job.version) tags.push(`v${job.version}`);
  if (job.expiresAt) tags.push(`expires in ${secondsUntil(job.expiresAt, now)}`);
  if (job.status === "pending" && job.runAt > now)
    tags.push(`due in ${secondsUntil(job.runAt, now)}`);

  return (
    <Card>
      <Row>
        <Text style={{ color: "#E8ECFF", fontWeight: "700", flex: 1 }}>{job.type}</Text>
        <Badge label={job.status} color={statusColor[job.status]} />
      </Row>
      <Text style={{ color: "#8C97C4", fontSize: 11 }}>
        {job.id} | attempt {job.attempts}/{job.maxAttempts}
        {job.externalId ? ` | external: ${job.externalId}` : ""}
      </Text>
      {job.status === "active" && job.progress !== undefined ? (
        <Progress value={job.progress} />
      ) : null}
      {tags.length ? (
        <Row wrap>
          {tags.map((tag) => (
            <Badge key={tag} label={tag} color="#8C97C4" />
          ))}
        </Row>
      ) : null}
      {job.lastError ? (
        <Text style={{ color: "#FF5C7A", fontSize: 12 }}>{job.lastError}</Text>
      ) : null}
      <Code>
        {job.sensitive ? "(sensitive payload is still stored; Events hides it)\n" : ""}
        {JSON.stringify(job.payload)}
      </Code>
      <Row wrap>
        {job.status === "failed" ? (
          <Btn
            label="Retry"
            small
            kind="ok"
            onPress={() => notify(queue.retry(job.id) ? "Retrying" : "Not failed")}
          />
        ) : null}
        {job.externalId ? (
          <>
            <Btn label="Complete" small kind="ok" onPress={() => queue.complete(job.id)} />
            <Btn
              label="Fail"
              small
              kind="danger"
              onPress={() => queue.fail(job.id, new Error("Native task failed"))}
            />
          </>
        ) : null}
        <Btn label="Details" small kind="ghost" onPress={onDetails} />
        <Btn
          label="Remove"
          small
          kind="danger"
          onPress={() => attempt(() => queue.remove(job.id))}
        />
      </Row>
    </Card>
  );
}

export function QueueScreen() {
  const [filter, setFilter] = useState<JobStatus | "all">("all");
  const [open, setOpen] = useState<string | undefined>();
  const jobs = useJobs(filter === "all" ? undefined : { status: filter });
  const { queue } = useRuntime();
  return (
    <Screen>
      <Heading>Queue</Heading>
      <Body muted>
        useJobs() returns saved jobs too, oldest first. Jobs survive an app restart.
      </Body>
      <Row wrap>
        {FILTERS.map((name) => (
          <Chip key={name} label={name} active={filter === name} onPress={() => setFilter(name)} />
        ))}
        <View style={{ flex: 1 }} />
        <Btn label="Clear all" small kind="danger" onPress={() => queue.clear()} />
      </Row>
      {jobs.length === 0 ? <Body muted>No jobs. Add some in the Lab tab.</Body> : null}
      {[...jobs].reverse().map((job) => (
        <JobCard key={job.id} job={job} onDetails={() => setOpen(job.id)} />
      ))}
      {open ? <Details id={open} onClose={() => setOpen(undefined)} /> : null}
    </Screen>
  );
}
