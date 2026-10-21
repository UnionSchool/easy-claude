"""隔离提醒回归：不请求通知权限、不读取账号，不发送实际提醒。"""
import json
import os
from pathlib import Path
import plistlib
import shutil
import subprocess
import tempfile
import time
import uuid

root = Path(__file__).resolve().parents[1]
product = json.loads((root / 'package.json').read_text())['name'].removeprefix('easy-')
app_name = 'Easy' + product.title() + 'Overlay'
source = root / 'native/build' / (app_name + '.app')
ids = ['codex:primary', 'codex:secondary'] if product == 'codex' else ['five_hour:primary', 'seven_day:primary']
with tempfile.TemporaryDirectory(prefix='easy-reminder-test-') as temporary:
    folder = Path(temporary)
    for label in ['early', 'restricted', 'missing', 'unknown', 'blocked-again', 'offline', 'permission-missing']:
        domain = 'com.unionschool.reminder-test-' + uuid.uuid4().hex
        work = folder / label
        work.mkdir()
        (work / 'overlay-ip.js').write_text('console.log(JSON.stringify({ip:"203.0.113.1",city:"Test City"}));')
        app = work / 'Test.app'
        shutil.copytree(source, app)
        info = app / 'Contents/Info.plist'
        metadata = plistlib.loads(info.read_bytes())
        metadata['CFBundleIdentifier'] = domain
        info.write_bytes(plistlib.dumps(metadata))
        subprocess.run(['codesign', '--force', '--sign', '-', str(app)], check=True, capture_output=True)
        now = time.time()
        due = now + 3600 if label == 'early' else now - 5
        reminder = {'ids': ids, 'due': due}
        preferences = work / 'prefs.plist'
        preferences.write_bytes(plistlib.dumps({'availabilityReminder': json.dumps(reminder).encode()}))
        subprocess.run(['defaults', 'import', domain, str(preferences)], check=True, capture_output=True)
        windows = [{'id': id, 'label': id, 'name': id, 'remaining': 100, 'resetsAt': now + 7200,
                    'windowDurationMins': minutes} for id, minutes in zip(ids, [300, 10080])]
        if label == 'missing': windows.pop()
        if label == 'unknown': windows[0]['remaining'] = None
        if label == 'blocked-again': windows[0]['remaining'] = 0
        response = {'windows': windows, 'restricted': label == 'restricted'}
        if label == 'offline': response = {'error': '模拟网络不可用', 'windows': []}
        query = 'const fs=require("node:fs");fs.appendFileSync(' + json.dumps(str(work / 'queries')) + ',"query\\n");'
        query += 'console.log(JSON.stringify({...'+json.dumps(response)+',fetchedAt:Date.now()/1000}));'
        (work / 'overlay-query.cjs').write_text(query)
        (work / 'check-update.js').write_text('console.log(JSON.stringify({available:false}));')
        process = None
        try:
            # 同一隔离偏好重启两次，验证开启状态和目标未因进程退出而丢失。
            for restart in range(2):
                process = subprocess.Popen([str(app / 'Contents/MacOS' / app_name), shutil.which('node'),
                    str(work / 'overlay-query.cjs'), os.environ['PATH'], ''], stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
                deadline = time.monotonic() + 10
                while time.monotonic() < deadline:
                    assert process.poll() is None, (process.returncode, process.communicate())
                    if (work / 'queries').exists() and (work / 'queries').read_text().count('query') > restart:
                        break
                    time.sleep(.1)
                else: raise AssertionError('开启提醒后未在后台查询')
                time.sleep(1)
                process.terminate()
                process.wait(timeout=5)
                process.stderr.close()
                process = None
                prefs = plistlib.loads(subprocess.check_output(['defaults', 'export', domain, '-']))
                saved = json.loads(prefs['availabilityReminder'])
                assert saved['ids'] == ids
                expected = now + 7200 if label == 'blocked-again' else due
                assert abs(saved['due'] - expected) < .01, (label, saved)
            print('PASS', product, label, '后台查询、未误提醒、跨重启保留', flush=True)
        finally:
            if process is not None:
                process.kill()
                process.wait()
                process.stderr.close()
            subprocess.run(['defaults', 'delete', domain], capture_output=True)
