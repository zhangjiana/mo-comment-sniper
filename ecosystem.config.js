module.exports = {
  apps: [
    {
      name: "maoer-comment-sniper",
      script: "server.js",
      cwd: "./",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      env: {
        HOST: "0.0.0.0",
        PORT: 3003,
      },
    },
  ],
};
