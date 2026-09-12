/**
 * DevEco Studio MCP 全量测试驱动 v2
 *
 * 策略:
 * - MCP 服务器(hdc 工具):list_targets, install, launch, hilog, screenshot, ui_dump, shell
 * - 直接执行(hvigorw 工具):clean, build, test
 *   原因:Node.js execFile 的 cwd 选项对 cmd.exe 子进程无效,
 *   导致 hvigor 报 "Path not found" 配置错误。
 *   修复:用 exec + cd /d 代替 execFile + cwd。
 *
 * 用法: node scripts/mcp-deveco-driver.cjs
 */
const { spawn, exec } = require('node:child_process');
const { promisify } = require('node:util');
const { join } = require('node:path');

const execAsync = promisify(exec);

// ─── 配置 ────────────────────────────────────────────────────────────
const MCP_SERVER_PATH = 'W:\\项目仓库\\dev studio mcp\\dist\\index.js';
const DEVECO_SDK_HOME = 'D:\\DevEco Studio\\sdk';
const NODE_HOME = 'D:\\DevEco Studio\\tools\\node';
const PROJECT_ROOT = 'w:\\wordaydream\\harmony';
const HVIGORW_PATH = 'D:\\DevEco Studio\\tools\\hvigor\\bin\\hvigorw.bat';

// ─── hvigorw 直接执行器(绕过 MCP 的 cwd bug)─────────────────────────
async function runHvigorw(args, timeoutMs = 300000) {
  const cmdArgs = ['--mode', 'module', '-p', 'product=default',
                   '--no-daemon', ...args].join(' ');
  // 关键:用 cd /d 代替 execFile 的 cwd 选项
  const cmd = `cd /d "${PROJECT_ROOT}" && "${HVIGORW_PATH}" ${cmdArgs}`;
  try {
    const { stdout, stderr } = await execAsync(cmd, {
      timeout: timeoutMs,
      maxBuffer: 20 * 1024 * 1024,
      env: {
        ...process.env,
        NODE_HOME,
        DEVECO_SDK_HOME,
        PATH: `${NODE_HOME};${process.env.PATH || ''}`,
      },
    });
    return (stdout + (stderr ? '\n' + stderr : '')).trim();
  } catch (e) {
    const output = (e.stdout || '') + (e.stderr || '');
    return output.trim() || e.message;
  }
}

// ─── JSON-RPC 客户端 ─────────────────────────────────────────────────
class McpClient {
  constructor(serverPath, env) {
    this.serverPath = serverPath;
    this.env = env;
    this.proc = null;
    this.buffer = '';
    this.pending = new Map();
    this.nextId = 1;
  }

  start() {
    return new Promise((resolve, reject) => {
      this.proc = spawn('node', [this.serverPath], {
        env: this.env,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      this.proc.stdout.on('data', (chunk) => {
        this.buffer += chunk.toString();
        this._processBuffer();
      });
      this.proc.stderr.on('data', () => {});
      this.proc.on('error', reject);
      this.proc.on('exit', (code) => {
        if (code !== 0 && code !== null) {
          for (const { reject: rej } of this.pending.values()) {
            rej(new Error(`MCP server exited with code ${code}`));
          }
        }
      });
      setTimeout(resolve, 500);
    });
  }

  _processBuffer() {
    let idx;
    while ((idx = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, idx).trim();
      this.buffer = this.buffer.slice(idx + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line);
        this._handleMessage(msg);
      } catch {}
    }
  }

  _handleMessage(msg) {
    if (msg.id !== undefined && this.pending.has(msg.id)) {
      const { resolve, reject } = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)));
      else resolve(msg.result);
    }
  }

  async _send(method, params) {
    const id = this.nextId++;
    const msg = { jsonrpc: '2.0', id, method, params: params || {} };
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.proc.stdin.write(JSON.stringify(msg) + '\n');
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`Request ${method} timed out after 300s`));
        }
      }, 300000);
    });
  }

  _notify(method, params) {
    const msg = { jsonrpc: '2.0', method, params: params || {} };
    this.proc.stdin.write(JSON.stringify(msg) + '\n');
  }

  async initialize() {
    const result = await this._send('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'mcp-deveco-driver', version: '2.0.0' },
    });
    this._notify('notifications/initialized', {});
    return result;
  }

  async listTools() {
    return await this._send('tools/list', {});
  }

  async callTool(name, args) {
    const result = await this._send('tools/call', { name, arguments: args || {} });
    if (result.content && result.content[0] && result.content[0].type === 'text') {
      return result.content[0].text;
    }
    return JSON.stringify(result);
  }

  stop() {
    if (this.proc) {
      this.proc.stdin.end();
      this.proc.kill();
    }
  }
}

// ─── 测试流程 ────────────────────────────────────────────────────────
async function main() {
  const env = {
    ...process.env,
    DEVECO_SDK_HOME,
    NODE_HOME,
    DEVECO_PROJECT_ROOT: PROJECT_ROOT,
  };

  const results = [];
  const client = new McpClient(MCP_SERVER_PATH, env);

  console.log('='.repeat(70));
  console.log('DevEco Studio MCP 全量测试驱动 v2');
  console.log('MCP 工具用于 hdc 设备操作 | hvigorw 直接执行(修复 cwd bug)');
  console.log('='.repeat(70));
  console.log(`Server: ${MCP_SERVER_PATH}`);
  console.log(`Project: ${PROJECT_ROOT}`);
  console.log(`SDK: ${DEVECO_SDK_HOME}`);
  console.log('');

  // 启动 MCP 服务器
  console.log('[1/9] 启动 MCP 服务器...');
  try {
    await client.start();
    console.log('  MCP 服务器进程已启动');
  } catch (e) {
    console.log(`  X 启动失败: ${e.message}`);
    process.exit(1);
  }

  // 1. initialize 握手
  console.log('\n[2/9] MCP initialize 握手...');
  try {
    const initResult = await client.initialize();
    const serverInfo = initResult.serverInfo || {};
    console.log(`  V 服务器: ${serverInfo.name} v${serverInfo.version}`);
    console.log(`  V 协议版本: ${initResult.protocolVersion}`);
    results.push({ step: 'MCP initialize', status: 'PASS', detail: `${serverInfo.name} v${serverInfo.version}` });
  } catch (e) {
    console.log(`  X 握手失败: ${e.message}`);
    results.push({ step: 'MCP initialize', status: 'FAIL', detail: e.message });
    client.stop();
    process.exit(1);
  }

  // 2. tools/list 验证
  console.log('\n[3/9] MCP tools/list 验证 12 个工具...');
  try {
    const toolsResult = await client.listTools();
    const tools = toolsResult.tools || [];
    const expected = ['list_targets', 'build', 'clean', 'test', 'install', 'uninstall',
                      'launch', 'hilog', 'screenshot', 'ui_dump', 'shell', 'deploy'];
    const toolNames = tools.map((t) => t.name);
    const missing = expected.filter((n) => !toolNames.includes(n));
    console.log(`  V 返回 ${tools.length} 个工具:`);
    tools.forEach((t) => console.log(`    - ${t.name}`));
    if (missing.length > 0) {
      console.log(`  ! 缺少: ${missing.join(', ')}`);
      results.push({ step: 'MCP tools/list', status: 'WARN', detail: `缺少 ${missing.length} 个` });
    } else {
      console.log(`  V 全部 ${expected.length} 个预期工具已注册`);
      results.push({ step: 'MCP tools/list', status: 'PASS', detail: `${tools.length} 个工具` });
    }
  } catch (e) {
    console.log(`  X tools/list 失败: ${e.message}`);
    results.push({ step: 'MCP tools/list', status: 'FAIL', detail: e.message });
  }

  // 3. MCP list_targets
  console.log('\n[4/9] MCP list_targets 检查设备...');
  let hasDevice = false;
  try {
    const targetsOutput = await client.callTool('list_targets', {});
    console.log(`  输出: ${targetsOutput || '(空)'}`);
    if (targetsOutput && targetsOutput.trim() && !targetsOutput.includes('[Empty]')) {
      const devices = targetsOutput.trim().split('\n').filter((l) => l.trim());
      hasDevice = devices.length > 0;
      console.log(`  V 检测到 ${devices.length} 个设备`);
      results.push({ step: 'MCP list_targets', status: 'PASS', detail: `${devices.length} 个设备` });
    } else {
      console.log('  i 无设备连接');
      results.push({ step: 'MCP list_targets', status: 'PASS', detail: '无设备连接' });
    }
  } catch (e) {
    console.log(`  X list_targets 失败: ${e.message}`);
    results.push({ step: 'MCP list_targets', status: 'FAIL', detail: e.message });
  }

  // 4. hvigorw clean (直接执行)
  console.log('\n[5/9] hvigorw clean (直接执行,cd /d 修复)...');
  try {
    const cleanOutput = await runHvigorw(['clean']);
    const success = cleanOutput.includes('BUILD SUCCESSFUL');
    console.log(`  ${success ? 'V' : 'X'} clean ${success ? '成功' : '失败'}`);
    const lines = cleanOutput.split('\n');
    console.log('  尾部输出:');
    lines.slice(-5).forEach((l) => console.log(`    ${l}`));
    results.push({ step: 'hvigorw clean', status: success ? 'PASS' : 'FAIL', detail: lines.slice(-2).join(' | ') });
  } catch (e) {
    console.log(`  X clean 失败: ${e.message}`);
    results.push({ step: 'hvigorw clean', status: 'FAIL', detail: e.message });
  }

  // 5. hvigorw build (直接执行)
  console.log('\n[6/9] hvigorw build debug (直接执行,cd /d 修复)...');
  try {
    const buildOutput = await runHvigorw(['assembleHap', '--build-mode=debug']);
    const success = buildOutput.includes('BUILD SUCCESSFUL');
    const lines = buildOutput.split('\n');
    const errorLines = lines.filter((l) => /ERROR/i.test(l) && !l.includes('BUILD'));
    const warnLines = lines.filter((l) => /WARN/i.test(l));

    console.log(`  ${success ? 'V' : 'X'} build ${success ? '成功' : '失败'}`);
    if (errorLines.length > 0) {
      console.log(`  错误(${errorLines.length} 行):`);
      errorLines.slice(0, 5).forEach((l) => console.log(`    ${l.trim()}`));
    }
    if (warnLines.length > 0) {
      console.log(`  警告: ${warnLines.length} 行`);
    }
    console.log('  尾部输出:');
    lines.slice(-5).forEach((l) => console.log(`    ${l}`));
    results.push({ step: 'hvigorw build', status: success ? 'PASS' : 'FAIL',
                   detail: `errors=${errorLines.length}, warns=${warnLines.length}` });
  } catch (e) {
    console.log(`  X build 失败: ${e.message}`);
    results.push({ step: 'hvigorw build', status: 'FAIL', detail: e.message });
  }

  // 6. hvigorw test (直接执行)
  console.log('\n[7/9] hvigorw test 单元测试 (直接执行)...');
  try {
    const testOutput = await runHvigorw(['test', '--no-daemon'], 300000);
    const success = testOutput.includes('BUILD SUCCESSFUL');
    const lines = testOutput.split('\n');
    const resultLines = lines.filter((l) => /test|pass|fail|suites|specs/i.test(l));

    console.log(`  ${success ? 'V' : 'X'} test ${success ? '完成' : '失败'}`);
    if (resultLines.length > 0) {
      console.log(`  关键输出:`);
      resultLines.slice(0, 10).forEach((l) => console.log(`    ${l.trim()}`));
    }
    console.log('  尾部输出:');
    lines.slice(-5).forEach((l) => console.log(`    ${l}`));
    results.push({ step: 'hvigorw test', status: success ? 'PASS' : 'FAIL',
                   detail: resultLines.slice(0, 2).join(' | ') || 'completed' });
  } catch (e) {
    console.log(`  X test 失败: ${e.message}`);
    results.push({ step: 'hvigorw test', status: 'FAIL', detail: e.message });
  }

  // 7. 设备端测试(MCP 工具)
  console.log('\n[8/9] 设备端测试 (MCP install/launch/screenshot/ui_dump/hilog)...');
  if (hasDevice) {
    // MCP install
    try {
      console.log('\n  --- MCP install ---');
      const installOutput = await client.callTool('install', {});
      const success = installOutput.includes('successfully') || !installOutput.includes('error');
      console.log(`  ${success ? 'V' : 'X'} install ${success ? '成功' : '失败'}`);
      console.log(`  输出: ${installOutput.slice(0, 200)}`);
      results.push({ step: 'MCP install', status: success ? 'PASS' : 'FAIL', detail: installOutput.slice(0, 100) });
    } catch (e) {
      console.log(`  X install 失败: ${e.message}`);
      results.push({ step: 'MCP install', status: 'FAIL', detail: e.message });
    }

    // MCP launch
    try {
      console.log('\n  --- MCP launch ---');
      const launchOutput = await client.callTool('launch', {});
      const success = !launchOutput.includes('error') && !launchOutput.includes('failed');
      console.log(`  ${success ? 'V' : 'X'} launch ${success ? '成功' : '失败'}`);
      console.log(`  输出: ${launchOutput.slice(0, 200)}`);
      results.push({ step: 'MCP launch', status: success ? 'PASS' : 'FAIL', detail: launchOutput.slice(0, 100) });
    } catch (e) {
      console.log(`  X launch 失败: ${e.message}`);
      results.push({ step: 'MCP launch', status: 'FAIL', detail: e.message });
    }

    console.log('\n  等待 3 秒...');
    await new Promise((r) => setTimeout(r, 3000));

    // MCP screenshot
    try {
      console.log('\n  --- MCP screenshot ---');
      const shotPath = join(process.env.TEMP || '/tmp', `harmony_test_${Date.now()}.png`);
      await client.callTool('screenshot', { savePath: shotPath });
      console.log(`  V 截图: ${shotPath}`);
      results.push({ step: 'MCP screenshot', status: 'PASS', detail: shotPath });
    } catch (e) {
      console.log(`  X screenshot 失败: ${e.message}`);
      results.push({ step: 'MCP screenshot', status: 'FAIL', detail: e.message });
    }

    // MCP ui_dump
    try {
      console.log('\n  --- MCP ui_dump ---');
      const uiOutput = await client.callTool('ui_dump', {});
      const success = uiOutput.includes('<') || uiOutput.includes('root');
      console.log(`  ${success ? 'V' : 'X'} ui_dump ${success ? '成功' : '失败'} (${uiOutput.length} 字符)`);
      results.push({ step: 'MCP ui_dump', status: success ? 'PASS' : 'FAIL', detail: `${uiOutput.length} 字符` });
    } catch (e) {
      console.log(`  X ui_dump 失败: ${e.message}`);
      results.push({ step: 'MCP ui_dump', status: 'FAIL', detail: e.message });
    }

    // MCP hilog
    try {
      console.log('\n  --- MCP hilog ---');
      const hilogOutput = await client.callTool('hilog', { tag: 'HarmonyBridge', lines: 50 });
      console.log(`  V 日志 (${hilogOutput.length} 字符)`);
      results.push({ step: 'MCP hilog', status: 'PASS', detail: `${hilogOutput.length} 字符` });
    } catch (e) {
      console.log(`  X hilog 失败: ${e.message}`);
      results.push({ step: 'MCP hilog', status: 'FAIL', detail: e.message });
    }
  } else {
    console.log('  i 跳过设备端测试(无已连接设备)');
    results.push({ step: 'MCP device-tests', status: 'SKIP', detail: '无设备连接' });
  }

  // 8. 验证 HAP 产物
  console.log('\n[9/9] 验证 HAP 构建产物...');
  try {
    const { readdirSync } = require('node:fs');
    const buildDir = join(PROJECT_ROOT, 'entry', 'build', 'default', 'outputs', 'default');
    const files = readdirSync(buildDir);
    const haps = files.filter((f) => f.endsWith('.hap'));
    if (haps.length > 0) {
      console.log(`  V 找到 ${haps.length} 个 HAP 文件:`);
      haps.forEach((f) => console.log(`    - ${f}`));
      results.push({ step: 'HAP 产物验证', status: 'PASS', detail: `${haps.length} 个 HAP` });
    } else {
      console.log('  X 未找到 HAP 文件');
      results.push({ step: 'HAP 产物验证', status: 'FAIL', detail: '无 HAP 文件' });
    }
  } catch (e) {
    console.log(`  X 验证失败: ${e.message}`);
    results.push({ step: 'HAP 产物验证', status: 'FAIL', detail: e.message });
  }

  // 停止 MCP 服务器
  client.stop();

  // 汇总报告
  console.log('\n' + '='.repeat(70));
  console.log('全量测试报告');
  console.log('='.repeat(70));
  const passCount = results.filter((r) => r.status === 'PASS').length;
  const failCount = results.filter((r) => r.status === 'FAIL').length;
  const warnCount = results.filter((r) => r.status === 'WARN').length;
  const skipCount = results.filter((r) => r.status === 'SKIP').length;

  results.forEach((r) => {
    const icon = r.status === 'PASS' ? 'V' : r.status === 'FAIL' ? 'X' : r.status === 'WARN' ? '!' : '-';
    console.log(`  ${icon} ${r.step.padEnd(22)} ${r.status.padEnd(6)} ${r.detail}`);
  });

  console.log('-'.repeat(70));
  console.log(`  总计: ${results.length} 项 | 通过 ${passCount} | 失败 ${failCount} | 警告 ${warnCount} | 跳过 ${skipCount}`);
  console.log('='.repeat(70));

  process.exit(failCount > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('Fatal error:', e);
  process.exit(1);
});
