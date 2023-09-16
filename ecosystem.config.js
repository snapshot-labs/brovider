module.exports = {
  apps: [
    {
      script: './build/src/index.js',
      instances: 2,
      exec_mode: 'cluster'
    }
  ]
};
