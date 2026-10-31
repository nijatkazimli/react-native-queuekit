// Resolves @nijatk/react-native-queuekit to the library build in ../../dist, so the app tests local changes.
const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");

const root = path.resolve(__dirname, "../..");
const config = getDefaultConfig(__dirname);

config.watchFolders = [path.join(root, "dist")];
// Only the app's node_modules: the library's dist must not pull in a second copy of React from the repo root.
config.resolver.nodeModulesPaths = [path.join(__dirname, "node_modules")];
config.resolver.disableHierarchicalLookup = true;
config.resolver.extraNodeModules = {
  "@nijatk/react-native-queuekit": path.join(root, "dist"),
};

module.exports = config;
