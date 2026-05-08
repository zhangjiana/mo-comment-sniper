module.exports = {
  apps: [
    {
      name: "maoer-comment-sniper",
      script: "server.js",
      cwd: "/Users/zhangjohn/Documents/trae_projects/maoer",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      env: {
        PORT: 3000,
      },
    },
  ],
};
