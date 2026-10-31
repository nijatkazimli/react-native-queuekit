import { QueueProvider } from "@nijatk/react-native-queuekit/react";
import { StatusBar } from "react-native";
import { FeedbackForm } from "./FeedbackForm";
import { PhotoUploads } from "./PhotoUploads";
import { queue } from "./queue";
import { SyncBanner } from "./SyncBanner";
import "./events";
import "./features";

export default function App() {
  return (
    <QueueProvider queue={queue}>
      <StatusBar barStyle="dark-content" />
      <SyncBanner />
      <FeedbackForm />
      <PhotoUploads albumId="holiday-2026" />
    </QueueProvider>
  );
}
