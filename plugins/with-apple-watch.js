const { withDangerousMod } = require('@expo/config-plugins');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

module.exports = function withAppleWatch(config) {
  return withDangerousMod(config, ['ios', (nextConfig) => {
    const script = path.join(nextConfig.modRequest.projectRoot, 'scripts', 'setup-watch-target.rb');
    const result = spawnSync('ruby', [script], { encoding: 'utf8' });
    if (result.status !== 0) {
      throw new Error(`Apple Watch target setup failed.\n${result.stderr || result.stdout}`);
    }
    return nextConfig;
  }]);
};
