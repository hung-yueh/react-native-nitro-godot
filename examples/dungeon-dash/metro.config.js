// metro.config.js
// Configures Metro to resolve the local react-native-nitro-godot module
// from the monorepo root (file:../../ dependency) and registers .pck as an asset.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// 1. Watch the parent directory so Metro sees changes to our local module
config.watchFolders = [monorepoRoot];

// 2. Tell Metro to resolve node_modules from both the example and the parent dir
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(monorepoRoot, 'node_modules'),
];

// 3. Force core RN packages to resolve from the example's node_modules.
//    The monorepo root has react-native@0.73.0 (library devDep) while this
//    example uses react-native@0.83.2. Without this, Metro loads the wrong
//    version at runtime → zero TurboModules register → PlatformConstants crash.
//    We intercept resolveRequest so that ANY import of these packages
//    (including from files inside the library at ../../src/) resolves here.
const FORCED_MODULES = {
  'react-native': path.resolve(projectRoot, 'node_modules/react-native'),
  'react': path.resolve(projectRoot, 'node_modules/react'),
  'react-native-reanimated': path.resolve(projectRoot, 'node_modules/react-native-reanimated'),
  'react-native-gesture-handler': path.resolve(projectRoot, 'node_modules/react-native-gesture-handler'),
  '@legendapp/state': path.resolve(projectRoot, 'node_modules/@legendapp/state'),
};

config.resolver.resolveRequest = (context, moduleName, platform) => {
  // Check if the bare import matches a forced module (or starts with it + /)
  for (const [pkg, pkgPath] of Object.entries(FORCED_MODULES)) {
    if (moduleName === pkg || moduleName.startsWith(pkg + '/')) {
      const subpath = moduleName === pkg ? '' : moduleName.slice(pkg.length);
      return context.resolveRequest(
        { ...context, resolveRequest: undefined },
        subpath ? pkgPath + subpath : pkgPath,
        platform,
      );
    }
  }
  // Default resolution for everything else
  return context.resolveRequest(context, moduleName, platform);
};

// 4. Add .pck (Godot Pack File) to the asset extensions Metro bundles
config.resolver.assetExts.push('pck');

module.exports = config;
