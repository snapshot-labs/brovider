module.exports = {
  apps: [
    {
      script: './build/src/index.js',
      instances: 4,
      exec_mode: 'cluster'
    }
  ]
};
