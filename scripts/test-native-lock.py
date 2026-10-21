"""内核更新锁回归：不安装软件、不读账号、不操作正式浮窗。"""
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import tempfile
import time

root = Path(__file__).resolve().parents[1]
product = json.loads((root / 'package.json').read_text())['name'].removeprefix('easy-')
app = 'Easy' + product.title() + 'Overlay'
binary = root / 'native/build' / (app + '.app') / 'Contents/MacOS' / app
node = shutil.which('node')
with tempfile.TemporaryDirectory(prefix='easy-kernel-lock-test-') as temporary:
    folder = Path(temporary)
    lock = folder / 'update.flock'
    def command(script):
        return [str(binary), '--with-update-lock', str(lock), node, '-e', script]
    def probe(expected=0):
        result = subprocess.run(command('process.exit(0)'), timeout=5, capture_output=True)
        assert result.returncode == expected, (result.returncode, result.stderr)
    holder = subprocess.Popen(command('console.log("held");setInterval(()=>{},1000)'), stdout=subprocess.PIPE, text=True)
    try:
        assert holder.stdout.readline().strip() == 'held'
        probe(75)
        holder.kill()
        holder.wait(timeout=3)
        probe()
        assert lock.exists(), '锁文件不需要删除，释放的是内核锁'
        assert subprocess.run(command('process.exit(12)'), timeout=5).returncode == 12
        probe()
        print('PASS', product, 'SIGKILL恢复、并发排他、异常退出后自动释放', flush=True)
    finally:
        if holder.poll() is None:
            holder.kill()
            holder.wait()
        holder.stdout.close()
    child_file = folder / 'child.pid'
    child_code = 'console.log("child");setInterval(()=>{},1000)'
    parent_code = 'const{spawn}=require("node:child_process");const{writeFileSync}=require("node:fs");'
    parent_code += 'const child=spawn(process.execPath,["-e",' + json.dumps(child_code) + '],{stdio:"inherit"});'
    parent_code += 'writeFileSync(' + json.dumps(str(child_file)) + ',String(child.pid));setInterval(()=>{},1000)'
    holder = subprocess.Popen(command(parent_code), stdout=subprocess.PIPE, text=True)
    child_pid = None
    try:
        assert holder.stdout.readline().strip() == 'child'
        child_pid = int(child_file.read_text())
        holder.kill()
        holder.wait(timeout=3)
        probe(75)  # 模拟npm仍在安装，不能因父进程强退而误解锁。
        os.kill(child_pid, signal.SIGKILL)
        child_pid = None
        deadline = time.monotonic() + 3
        while True:
            result = subprocess.run(command('process.exit(0)'), capture_output=True, timeout=5)
            if result.returncode == 0:
                break
            assert result.returncode == 75 and time.monotonic() < deadline
            time.sleep(.05)
        print('PASS', product, '安装子进程继承锁，最后持有者退出后自动恢复', flush=True)
    finally:
        if child_pid is not None:
            try:
                os.kill(child_pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
        if holder.poll() is None:
            holder.kill()
            holder.wait()
        holder.stdout.close()
    (folder / 'update.lock').mkdir()  # 旧版遗留空目录不参与新锁判断。
    probe()
    print('PASS', product, '旧锁目录无需手动清理', flush=True)
