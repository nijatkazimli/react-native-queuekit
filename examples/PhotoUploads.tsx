import { useJobs, useQueue } from "@nijatk/react-native-queuekit/react";
import { launchImageLibraryAsync } from "expo-image-picker";
import { Button, FlatList, Image, Text, View } from "react-native";
import type { PhotoUpload } from "./features/photos";
import { uploadPhoto } from "./features/photos";

const LABEL = { pending: "Waiting", active: "Uploading", failed: "Failed" } as const;

export function PhotoUploads({ albumId }: Readonly<{ albumId: string }>) {
  const queue = useQueue();
  // Re-renders only when jobs change. Includes jobs saved before the last app restart.
  const uploads = useJobs({ type: uploadPhoto.type });

  const addPhotos = async () => {
    const result = await launchImageLibraryAsync({ allowsMultipleSelection: true });
    for (const asset of result.assets ?? []) {
      // dedupeKey: picking the same photo twice doesn't upload it twice.
      uploadPhoto({ uri: asset.uri, albumId }, { dedupeKey: asset.uri });
    }
  };

  return (
    <View style={{ flex: 1 }}>
      <Button title="Add photos" onPress={addPhotos} />
      <FlatList
        data={uploads}
        keyExtractor={(job) => job.id}
        renderItem={({ item }) => (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 12 }}>
            <Image
              source={{ uri: (item.payload as PhotoUpload).uri }}
              style={{ width: 48, height: 48 }}
            />
            <View style={{ flex: 1 }}>
              <Text>{LABEL[item.status]}</Text>
              {item.lastError && <Text>{item.lastError}</Text>}
            </View>
            {item.status === "failed" && (
              <Button title="Retry" onPress={() => queue.retry(item.id)} />
            )}
            <Button title="Cancel" onPress={() => queue.remove(item.id)} />
          </View>
        )}
      />
    </View>
  );
}
