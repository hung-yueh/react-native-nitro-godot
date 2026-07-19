// metro.config.js
// Standard Expo Metro config with .pck asset extension for Godot Pack Files.
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Add .pck (Godot Pack File) to the asset extensions Metro bundles
config.resolver.assetExts.push('pck');

module.exports = config;
