import { useState } from "react";
import { Alert, Button, TextInput, View } from "react-native";
import { submitFeedback } from "./features/feedback";

// Works offline: the submit is saved instantly and sent when a connection is available.
export function FeedbackForm() {
  const [comment, setComment] = useState("");

  const submit = () => {
    submitFeedback({ rating: 5, comment });
    setComment("");
    Alert.alert("Thanks!", "Your feedback will be sent as soon as you're online.");
  };

  return (
    <View style={{ padding: 16, gap: 12 }}>
      <TextInput
        value={comment}
        onChangeText={setComment}
        placeholder="Tell us what you think"
        multiline
      />
      <Button title="Send" onPress={submit} disabled={!comment.trim()} />
    </View>
  );
}
