module.exports = {
    apps: [
        {
            name: "folk-api",
            script: "server.js",

            // Restart settings
            watch: false,
            autorestart: true,
            max_memory_restart: "500M",

            // Environment (ONLY non-sensitive values here)
            env: {
                NODE_ENV: "production",
                PORT: 3000
            }
        }
    ]
};