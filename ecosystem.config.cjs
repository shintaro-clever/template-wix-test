module.exports = {
  apps: [
    {
      name: "integration-hub",
      script: "server.js",
      cwd: "/srv/integration-hub",
      env: {
        HOST: "127.0.0.1",
        PORT: "3000",
        HUB_PUBLIC_ORIGIN: "https://hub.test-plan.help",
        NODE_ENV: "production"
      }
    }
  ]
};
