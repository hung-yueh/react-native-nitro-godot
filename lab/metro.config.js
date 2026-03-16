// metro.config.js
// Configures Metro to resolve the local react-native-nitro-godot module
// from the parent directory (file:../ dependency) and registers .pck as an asset.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, '..');

const config = getDefaultConfig(projectRoot);

// 1. Watch the parent directory so Metro sees changes to our local module
config.watchFolders = [monorepoRoot];

// 2. Tell Metro to resolve node_modules from both the example and the parent dir
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(monorepoRoot, 'node_modules'),
];

// 3. Add .pck (Godot Pack File) to the asset extensions Metro bundles
config.resolver.assetExts.push('pck');

module.exports = config;
