"""隔离原生回归，不访问账号、不安装 npm 包、不修改正式浮窗配置。"""
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
name = json.loads((root / 'package.json').read_text())['name']
product = name.removeprefix('easy-')
app_name = 'Easy' + product.title() + 'Overlay'
source = root / 'native/build' / (app_name + '.app')
cases = [
    ('disabled', False, True, None, False, 0, True),
    ('latest', True, False, None, False, 0, False),
    ('available', True, True, None, False, 1, True),
    ('offline-keeps-dot', True, 'offline', 'current', False, 0, True),
    ('invalid-keeps-dot', False, 'invalid', 'current', False, 0, True),
    ('success-clears-dot', False, False, 'current', False, 0, False),
    ('changed-version', False, 'offline', 'older', False, 0, False),
    ('restart-cleans-log', True, True, None, True, 1, True),
]
with tempfile.TemporaryDirectory(prefix=name + '-native-tests-') as temporary:
    base = Path(temporary)
    for label, enabled, available, cache, exit_parent, expected_count, expected_dot in cases:
        domain = 'com.unionschool.update-test-' + uuid.uuid4().hex
        work = base / label
        work.mkdir()
        app = work / 'Test.app'
        shutil.copytree(source, app)
        plist = app / 'Contents/Info.plist'
        metadata = plistlib.loads(plist.read_bytes())
        metadata['CFBundleIdentifier'] = domain
        plist.write_bytes(plistlib.dumps(metadata))
        subprocess.run(['codesign', '--force', '--sign', '-', str(app)], check=True, capture_output=True)
        (work / 'overlay-query.js').write_text('console.log(JSON.stringify({error:"测试实例",fetchedAt:0,windows:[]}));')
        check = 'import {appendFileSync} from "node:fs";appendFileSync(' + json.dumps(str(work / 'checks')) + ',"check\\n");'
        if available == 'offline':
            check += 'process.exit(1);'
        elif available == 'invalid':
            check += 'console.log("invalid");'
        else:
            check += 'console.log(JSON.stringify({available:' + str(available).lower() + '}));'
        (work / 'check-update.js').write_text(check)
        update = 'import {appendFileSync,fstatSync,writeFileSync,writeSync} from "node:fs";'
        update += 'appendFileSync(' + json.dumps(str(work / 'updates')) + ',"update\\n");'
        update += 'writeFileSync(' + json.dumps(str(work / 'log-links')) + ',String(fstatSync(1).nlink));'
        if exit_parent:
            update += 'process.kill(process.ppid,"SIGTERM");'
        update += 'writeSync(1,"test update output");'
        (work / 'overlay-update.js').write_text(update)
        process = None
        try:
            def preference(key, kind, value):
                subprocess.run(['defaults', 'write', domain, key, kind, str(value)], check=True)
            preference('automaticUpdatesEnabled', '-bool', str(enabled).lower())
            if cache:
                preference('updateCheckedVersion', '-string', metadata['CFBundleShortVersionString'] if cache == 'current' else 'older')
                preference('updateAvailable', '-bool', 'true')
                preference('updateLastAttempt', '-float', '0')
            process = subprocess.Popen([str(app / 'Contents/MacOS' / app_name), shutil.which('node'),
                str(work / 'overlay-query.js'), os.environ['PATH'], ''], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            deadline = time.monotonic() + 12
            while not (work / 'checks').exists() and time.monotonic() < deadline:
                assert process.poll() is None, (label, 'test app exited')
                time.sleep(.1)
            assert (work / 'checks').exists(), (label, 'check did not start')
            time.sleep(2)
            assert (work / 'checks').read_text().count('check') == 1, (label, 'daily check repeated')
            count = (work / 'updates').read_text().count('update') if (work / 'updates').exists() else 0
            assert count == expected_count, (label, count)
            settings = plistlib.loads(subprocess.check_output(['defaults', 'export', domain, '-']))
            assert settings['updateAvailable'] == expected_dot, (label, settings)
            if count:
                assert (work / 'log-links').read_text() == '0', (label, 'log name still exists')
            if exit_parent:
                assert process.poll() is not None, (label, 'old app did not exit')
            print('PASS', name, label, flush=True)
        finally:
            if process is not None:
                process.terminate()
                try:
                    process.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()
            subprocess.run(['defaults', 'delete', domain], capture_output=True)
