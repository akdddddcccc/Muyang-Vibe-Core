module.exports = {
  apps: [
    {
      name: "muyang-live-sticker-api",
      cwd: "/opt/operation/Muyang-Vibe-Core",
      script: "services/live-sticker-api/src/server.mjs",
      interpreter: "node",
      node_args: "--env-file=/etc/muyang/live-sticker-api.env",
      env: { NODE_ENV: "production" },
      autorestart: true,
      max_restarts: 10,
      restart_delay: 2000,
    },
  ],
};
