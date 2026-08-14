// Metro in an npm-workspaces monorepo. Without this, bundling `@factory/sim`
// fails: Metro only watches its own project folder by default, and the sim
// package lives one level up.
const path = require('path')
const { getDefaultConfig } = require('expo/metro-config')

const projectRoot = __dirname
const workspaceRoot = path.resolve(projectRoot, '..')

const config = getDefaultConfig(projectRoot)

// Watch the whole repo so edits to packages/sim trigger a reload.
config.watchFolders = [workspaceRoot]

// npm hoists dependencies to the root, so look there too.
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
]

// `disableHierarchicalLookup` is deliberately *not* set. It used to be true,
// from the older Expo monorepo recipe, and expo-doctor now flags that: turning
// hierarchical lookup off leaves the two paths above as the only places Metro
// will look, which is a strict subset of what it does by default. Since every
// dependency hoists to the workspace root and that root is already listed, the
// setting was ruling things out rather than ruling anything in. Removing it
// leaves the exported bundle byte-identical, which is what says it was
// redundant rather than load-bearing.

module.exports = config
