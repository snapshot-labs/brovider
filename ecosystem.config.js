module.exports = {
  apps: [
    {
      script: './build/src/index.js',
      instances: 3,
      exec_mode: 'cluster'
    }
  ]
};
