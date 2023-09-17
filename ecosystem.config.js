module.exports = {
  apps: [
    {
      script: './build/src/index.js',
      instances: 'max',
      exec_mode: 'cluster'
    }
  ]
};
