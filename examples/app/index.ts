import { registerRootComponent } from "expo";
import App from "./App";
// Registers the background task before React starts, so the OS can run it headless.
import "./src/background";

registerRootComponent(App);
