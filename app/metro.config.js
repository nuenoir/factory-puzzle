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
config.resolver.disableHierarchicalLookup = true

module.exports = config
