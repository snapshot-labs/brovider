module.exports = {
  apps: [
    {
      script: './dist/src/index.js',
      instances: 'max',
      exec_mode: 'cluster'
    }
  ]
};
