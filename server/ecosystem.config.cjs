/**
 * PM2 进程配置 - 让 LLM 代理服务后台运行 + 开机自启 + 崩溃自动重启
 *
 * 使用方法:
 *   pm2 start ecosystem.config.cjs
 *   pm2 logs wordaydream-proxy    查看日志
 *   pm2 restart wordaydream-proxy 重启
 *   pm2 stop wordaydream-proxy    停止
 *   pm2 save                      保存进程列表
 *   pm2 startup                   设置开机自启
 */
module.exports = {
  apps: [
    {
      name: 'wordaydream-proxy',
      script: 'llm-proxy.js',
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
      env: {
        NODE_ENV: 'production',
        PORT: 3001,
        // API key 从 .env 文件读取, 或直接在这里填写
        // DEEPSEEK_API_KEY: 'sk-xxx',
        // OPENAI_API_KEY: 'sk-xxx',
        // ANTHROPIC_API_KEY: 'sk-xxx',
      },
      error_file: './logs/error.log',
      out_file: './logs/out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
  ],
};
