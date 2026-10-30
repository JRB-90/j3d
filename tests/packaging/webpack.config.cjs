const path = require('node:path');

// The plainest config a project could have: nothing here is for J3D, which is the point of the check.
module.exports = {
  entry: './src/main.js',
  output: { path: path.resolve(__dirname, 'dist-webpack'), filename: 'main.js', publicPath: '/', clean: true },
  devServer: { port: 5303, host: '127.0.0.1', static: path.resolve(__dirname, 'webpack-public'), hot: false, liveReload: false, client: false },
  performance: { hints: false },
};
