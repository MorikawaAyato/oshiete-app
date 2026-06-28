const { getDefaultConfig } = require('expo/metro-config')
const path = require('path')

const config = getDefaultConfig(__dirname)

config.resolver.extraNodeModules = {
  ...config.resolver.extraNodeModules,
  'react-dom': path.resolve(__dirname, 'react-dom-stub.js'),
}

module.exports = config
